using System;
using System.Text;
using System.Threading.Tasks;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.Compilation;
using UnityEngine;

namespace SprintTicker.Unity.Editor
{
    /// <summary>
    /// Lightweight Unity Editor script that hooks into compilation events, Play Mode state transitions,
    /// player build preprocess/scene hooks, console exceptions, and periodic heartbeats, posting JSON telemetry webhooks.
    /// Architectural Rationale: Non-blocking HTTP POST requests run asynchronously on background threads to ensure 
    /// Unity Editor performance is never degraded even if the desktop companion app is closed.
    /// </summary>
    [InitializeOnLoad]
    public class BusyBarWebhookPublisher : IPreprocessBuildWithReport, IProcessSceneWithReport, IPostprocessBuildWithReport
    {
        private const string WebhookBaseUrl = "http://127.0.0.1:39123/api/v1/unity";
        private const double HeartbeatIntervalSeconds = 5.0;

        private static readonly System.Net.Http.HttpClient _httpClient = new System.Net.Http.HttpClient
        {
            Timeout = TimeSpan.FromSeconds(1)
        };
        private static readonly string _instanceId = $"{Application.productName}_{System.Diagnostics.Process.GetCurrentProcess().Id}";
        private static double _lastHeartbeatTime;
        private static double _lastBakeProgressTime;
        private static float _lastReportedBakeProgress = -1f;

        private static bool _wasBakingLightmaps;

        private static int _totalAssemblies = 0;
        private static int _compiledAssemblies = 0;

        private static int _totalBuildScenes = 0;
        private static int _processedBuildScenes = 0;

        /// <summary>
        /// Gets the order in which build pipeline callbacks are invoked. Returns 0 to execute early in the build pipeline.
        /// </summary>
        public int callbackOrder => 0;

        #region Player Build Hooks (IPreprocessBuildWithReport, IProcessSceneWithReport, IPostprocessBuildWithReport)
        /// <summary>
        /// Intercepts the start of player build processing to broadcast initial build telemetry to the BUSY Bar.
        /// Why: Enables hardware display to show build progress bars to the developer during long standalone builds.
        /// </summary>
        public void OnPreprocessBuild(BuildReport report)
        {
            _processedBuildScenes = 0;
            _totalBuildScenes = EditorBuildSettings.scenes != null 
                ? System.Array.FindAll(EditorBuildSettings.scenes, s => s.enabled).Length 
                : 0;

            DispatchCompilePayload("started", "build", 0);
        }

        /// <summary>
        /// Intercepts per-scene processing during standalone builds to update progress metrics.
        /// Why: Provides real-time incremental build progress on the BUSY Bar display as scenes compile.
        /// </summary>
        public void OnProcessScene(UnityEngine.SceneManagement.Scene scene, BuildReport report)
        {
            if (BuildPipeline.isBuildingPlayer && report != null)
            {
                _processedBuildScenes++;
                int progressPct = _totalBuildScenes > 0 
                    ? (int)((float)_processedBuildScenes / _totalBuildScenes * 90f) 
                    : 50;

                progressPct = Math.Max(10, Math.Min(90, progressPct));
                DispatchCompilePayload("started", "build", progressPct);
            }
        }

        /// <summary>
        /// Intercepts build completion or failure to play success chimes or trigger error LED alerts.
        /// Why: Notifies developers immediately on build finish regardless of whether Unity window is focused.
        /// </summary>
        public void OnPostprocessBuild(BuildReport report)
        {
            bool isSuccess = (report != null && report.summary.result == BuildResult.Succeeded);
            DispatchCompilePayload("finished", "build", 100, isSuccess);
        }
        #endregion

        static BusyBarWebhookPublisher()
        {
            CompilationPipeline.compilationStarted -= OnCompilationStarted;
            CompilationPipeline.compilationFinished -= OnCompilationFinished;
            CompilationPipeline.assemblyCompilationStarted -= OnAssemblyCompilationStarted;
            CompilationPipeline.assemblyCompilationFinished -= OnAssemblyCompilationFinished;

            CompilationPipeline.compilationStarted += OnCompilationStarted;
            CompilationPipeline.compilationFinished += OnCompilationFinished;
            CompilationPipeline.assemblyCompilationStarted += OnAssemblyCompilationStarted;
            CompilationPipeline.assemblyCompilationFinished += OnAssemblyCompilationFinished;

            AssemblyReloadEvents.beforeAssemblyReload += OnBeforeAssemblyReload;
            AssemblyReloadEvents.afterAssemblyReload += OnAfterAssemblyReload;
            EditorApplication.playModeStateChanged += OnPlayModeStateChanged;
            Application.logMessageReceivedThreaded += OnLogMessageReceived;
            EditorApplication.update += OnEditorUpdate;

            Lightmapping.bakeStarted += OnBakeStarted;
            Lightmapping.bakeCompleted += OnBakeCompleted;

            SendHeartbeat();
        }

        /// <summary>
        /// Dispatches a periodic heartbeat ping to the desktop companion app containing active project context and bound scene save port.
        /// Why: Registers active Unity instances with desktop app so EOD scene saves and playmode status updates route accurately.
        /// </summary>
        public static void SendHeartbeat()
        {
            _lastHeartbeatTime = EditorApplication.timeSinceStartup;
            var payload = new HeartbeatEventPayload
            {
                instanceId = _instanceId,
                projectName = Application.productName,
                unityVersion = Application.unityVersion,
                compiling = EditorApplication.isCompiling,
                playMode = EditorApplication.isPlaying,
                savePort = BusyBarSceneSaveListener.BoundPort
            };
            SendWebhookAsync($"{WebhookBaseUrl}/heartbeat", JsonUtility.ToJson(payload));
        }

        private static void OnEditorUpdate()
        {
            double now = EditorApplication.timeSinceStartup;
            if (now - _lastHeartbeatTime >= HeartbeatIntervalSeconds)
            {
                SendHeartbeat();
            }

            CheckLightmapBakeProgress(now);
        }

        private static void CheckLightmapBakeProgress(double now)
        {
            bool isBaking = Lightmapping.isRunning;
            if (isBaking != _wasBakingLightmaps)
            {
                _wasBakingLightmaps = isBaking;
                DispatchCompilePayload(isBaking ? "started" : "finished", "bake", isBaking ? 0 : 100, !isBaking);
            }

            if (isBaking)
            {
                float currentProgress = Lightmapping.buildProgress;
                if (Math.Abs(currentProgress - _lastReportedBakeProgress) >= 0.02f || now - _lastBakeProgressTime >= 1.0)
                {
                    _lastReportedBakeProgress = currentProgress;
                    _lastBakeProgressTime = now;
                    int bakePct = Math.Max(0, Math.Min(100, (int)(currentProgress * 100f)));
                    DispatchCompilePayload("started", "bake", bakePct);
                }
            }
        }

        private static void OnCompilationStarted(object context)
        {
            _totalAssemblies = CompilationPipeline.GetAssemblies().Length;
            _compiledAssemblies = 0;
            DispatchCompilePayload("started", "compile", 0);
        }

        private static void OnCompilationFinished(object context)
        {
            DispatchCompilePayload("finished", "compile", 100, true);
        }

        private static void OnBakeStarted()
        {
            _lastReportedBakeProgress = 0f;
            DispatchCompilePayload("started", "bake", 0);
        }

        private static void OnBakeCompleted()
        {
            bool isCancelled = _lastReportedBakeProgress < 0.99f;
            _lastReportedBakeProgress = -1f;
            DispatchCompilePayload("finished", "bake", 100, !isCancelled);
        }

        private static void OnBeforeAssemblyReload()
        {
            DispatchCompilePayload("started", "compile", 0);
        }

        private static void OnAfterAssemblyReload()
        {
            DispatchCompilePayload("finished", "compile", 100, true);
        }

        private static void OnAssemblyCompilationStarted(string assemblyPath)
        {
            int pct = _totalAssemblies > 0 ? (int)(100f * _compiledAssemblies / _totalAssemblies) : 0;
            DispatchCompilePayload("started", "compile", pct);
        }

        private static void OnAssemblyCompilationFinished(string assemblyPath, CompilerMessage[] compilerMessages)
        {
            _compiledAssemblies++;
            int pct = _totalAssemblies > 0 ? (int)(100f * _compiledAssemblies / _totalAssemblies) : 100;
            (int errors, int warnings) = CountCompilerMessages(compilerMessages);

            var payload = new CompileEventPayload
            {
                instanceId = _instanceId,
                state = "started",
                type = "compile",
                progress = pct,
                projectName = Application.productName,
                unityVersion = Application.unityVersion,
                success = (errors == 0),
                errorCount = errors,
                warningCount = warnings
            };
            SendWebhookAsync($"{WebhookBaseUrl}/compile", JsonUtility.ToJson(payload));
        }

        private static (int errors, int warnings) CountCompilerMessages(CompilerMessage[] compilerMessages)
        {
            int errors = 0;
            int warnings = 0;
            if (compilerMessages != null)
            {
                foreach (var msg in compilerMessages)
                {
                    if (msg.type == CompilerMessageType.Error) errors++;
                    else if (msg.type == CompilerMessageType.Warning) warnings++;
                }
            }
            return (errors, warnings);
        }

        private static void OnPlayModeStateChanged(PlayModeStateChange state)
        {
            if (state == PlayModeStateChange.EnteredPlayMode || state == PlayModeStateChange.ExitingPlayMode || state == PlayModeStateChange.EnteredEditMode)
            {
                var payload = new PlayModeEventPayload
                {
                    instanceId = _instanceId,
                    state = (state == PlayModeStateChange.EnteredPlayMode) ? "entered" : "exited",
                    projectName = Application.productName
                };
                SendWebhookAsync($"{WebhookBaseUrl}/playmode", JsonUtility.ToJson(payload));
            }
        }

        private static void OnLogMessageReceived(string condition, string stackTrace, LogType type)
        {
            if (type == LogType.Exception || type == LogType.Error)
            {
                var payload = new ConsoleEventPayload
                {
                    instanceId = _instanceId,
                    type = (type == LogType.Exception) ? "exception" : "error",
                    message = condition,
                    stackTrace = stackTrace,
                    projectName = Application.productName
                };
                SendWebhookAsync($"{WebhookBaseUrl}/console", JsonUtility.ToJson(payload));
            }
        }

        private static void DispatchCompilePayload(string state, string type, int progress, bool success = true)
        {
            var payload = new CompileEventPayload
            {
                instanceId = _instanceId,
                state = state,
                type = type,
                progress = progress,
                projectName = Application.productName,
                unityVersion = Application.unityVersion,
                success = success
            };
            SendWebhookAsync($"{WebhookBaseUrl}/compile", JsonUtility.ToJson(payload));
        }

        /// <summary>
        /// Sends JSON payload via background ThreadPool so network requests are dispatched immediately 
        /// even when the Unity main thread is blocked executing a build pipeline.
        /// Why: Guarantees zero latency visual updates on BUSY Bar display without blocking Unity UI.
        /// </summary>
        private static void SendWebhookAsync(string url, string jsonBody)
        {
            Task.Run(async () =>
            {
                try
                {
                    var content = new System.Net.Http.StringContent(jsonBody, Encoding.UTF8, "application/json");
                    await _httpClient.PostAsync(url, content).ConfigureAwait(false);
                }
                catch
                {
                    // Suppress network exception to ensure execution loop is unaffected
                }
            });
        }

        [Serializable]
        public class HeartbeatEventPayload
        {
            public string instanceId;
            public string projectName;
            public string unityVersion;
            public bool compiling;
            public bool playMode;
            public int savePort;
        }

        [Serializable]
        public class CompileEventPayload
        {
            public string instanceId;
            public string state;
            public string type;
            public int progress;
            public string projectName;
            public string unityVersion;
            public bool success;
            public int errorCount;
            public int warningCount;
        }

        [Serializable]
        public class PlayModeEventPayload
        {
            public string instanceId;
            public string state;
            public string projectName;
        }

        [Serializable]
        public class ConsoleEventPayload
        {
            public string instanceId;
            public string type;
            public string message;
            public string stackTrace;
            public string projectName;
        }
    }
}