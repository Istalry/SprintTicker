using System;
using System.Text;
using System.Threading.Tasks;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.Compilation;
using UnityEngine;

namespace Com.Antigravity.BusyBar.Editor
{
    /// <summary>
    /// Lightweight Unity Editor script that hooks into compilation events, Play Mode state transitions,
    /// player build preprocess/scene hooks, console exceptions, and periodic heartbeats, posting JSON telemetry webhooks.
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

        private static int s_TotalAssemblies = 0;
        private static int s_CompiledAssemblies = 0;

        private static int s_TotalBuildScenes = 0;
        private static int s_ProcessedBuildScenes = 0;

        public int callbackOrder => 0;

        #region Player Build Hooks (IPreprocessBuildWithReport, IProcessSceneWithReport, IPostprocessBuildWithReport)
        public void OnPreprocessBuild(BuildReport report)
        {
            s_ProcessedBuildScenes = 0;
            s_TotalBuildScenes = EditorBuildSettings.scenes != null 
                ? System.Array.FindAll(EditorBuildSettings.scenes, s => s.enabled).Length 
                : 0;

            var payload = new CompileEventPayload
            {
                instanceId = _instanceId,
                state = "started",
                type = "build",
                progress = 0,
                projectName = Application.productName,
                unityVersion = Application.unityVersion
            };
            SendWebhookAsync($"{WebhookBaseUrl}/compile", JsonUtility.ToJson(payload));
        }

        public void OnProcessScene(UnityEngine.SceneManagement.Scene scene, BuildReport report)
        {
            // Invoked synchronously on main thread as each scene is compiled into the build
            if (BuildPipeline.isBuildingPlayer && report != null)
            {
                s_ProcessedBuildScenes++;
                int progressPct = s_TotalBuildScenes > 0 
                    ? (int)((float)s_ProcessedBuildScenes / s_TotalBuildScenes * 90f) 
                    : 50;

                // Clamp progress between 10% and 90% while scenes process
                progressPct = Math.Max(10, Math.Min(90, progressPct));

                var payload = new CompileEventPayload
                {
                    instanceId = _instanceId,
                    state = "started",
                    type = "build",
                    progress = progressPct,
                    projectName = Application.productName,
                    unityVersion = Application.unityVersion
                };
                SendWebhookAsync($"{WebhookBaseUrl}/compile", JsonUtility.ToJson(payload));
            }
        }

        public void OnPostprocessBuild(BuildReport report)
        {
            var payload = new CompileEventPayload
            {
                instanceId = _instanceId,
                state = "finished",
                type = "build",
                progress = 100,
                projectName = Application.productName,
                unityVersion = Application.unityVersion,
                success = (report != null && report.summary.result == BuildResult.Succeeded)
            };
            SendWebhookAsync($"{WebhookBaseUrl}/compile", JsonUtility.ToJson(payload));
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

            // Real-time Lightmapping polling
            bool isBaking = Lightmapping.isRunning;
            if (isBaking != _wasBakingLightmaps)
            {
                _wasBakingLightmaps = isBaking;
                var bakeStatePayload = new CompileEventPayload
                {
                    instanceId = _instanceId,
                    state = isBaking ? "started" : "finished",
                    type = "bake",
                    progress = isBaking ? 0 : 100,
                    projectName = Application.productName,
                    unityVersion = Application.unityVersion,
                    success = !isBaking
                };
                SendWebhookAsync($"{WebhookBaseUrl}/compile", JsonUtility.ToJson(bakeStatePayload));
            }

            if (isBaking)
            {
                float currentProgress = Lightmapping.buildProgress;
                if (Math.Abs(currentProgress - _lastReportedBakeProgress) >= 0.02f || now - _lastBakeProgressTime >= 1.0)
                {
                    _lastReportedBakeProgress = currentProgress;
                    _lastBakeProgressTime = now;

                    int bakePct = Math.Max(0, Math.Min(100, (int)(currentProgress * 100f)));
                    var bakePayload = new CompileEventPayload
                    {
                        instanceId = _instanceId,
                        state = "started",
                        type = "bake",
                        progress = bakePct,
                        projectName = Application.productName,
                        unityVersion = Application.unityVersion
                    };
                    SendWebhookAsync($"{WebhookBaseUrl}/compile", JsonUtility.ToJson(bakePayload));
                }
            }
        }

        private static void OnCompilationStarted(object context)
        {
            s_TotalAssemblies = CompilationPipeline.GetAssemblies().Length;
            s_CompiledAssemblies = 0;
            var payload = new CompileEventPayload
            {
                instanceId = _instanceId,
                state = "started",
                type = "compile",
                progress = 0,
                projectName = Application.productName,
                unityVersion = Application.unityVersion
            };
            SendWebhookAsync($"{WebhookBaseUrl}/compile", JsonUtility.ToJson(payload));
        }

        private static void OnCompilationFinished(object context)
        {
            var payload = new CompileEventPayload
            {
                instanceId = _instanceId,
                state = "finished",
                type = "compile",
                progress = 100,
                projectName = Application.productName,
                unityVersion = Application.unityVersion,
                success = true
            };
            SendWebhookAsync($"{WebhookBaseUrl}/compile", JsonUtility.ToJson(payload));
        }

        private static void OnBakeStarted()
        {
            _lastReportedBakeProgress = 0f;
            var payload = new CompileEventPayload
            {
                instanceId = _instanceId,
                state = "started",
                type = "bake",
                progress = 0,
                projectName = Application.productName,
                unityVersion = Application.unityVersion
            };
            SendWebhookAsync($"{WebhookBaseUrl}/compile", JsonUtility.ToJson(payload));
        }

        private static void OnBakeCompleted()
        {
            bool isCancelled = _lastReportedBakeProgress < 0.99f;
            _lastReportedBakeProgress = -1f;
            var payload = new CompileEventPayload
            {
                instanceId = _instanceId,
                state = "finished",
                type = "bake",
                progress = 100,
                projectName = Application.productName,
                unityVersion = Application.unityVersion,
                success = !isCancelled
            };
            SendWebhookAsync($"{WebhookBaseUrl}/compile", JsonUtility.ToJson(payload));
        }

        private static void OnBeforeAssemblyReload()
        {
            var payload = new CompileEventPayload
            {
                instanceId = _instanceId,
                state = "started",
                type = "compile",
                progress = 0,
                projectName = Application.productName,
                unityVersion = Application.unityVersion
            };
            SendWebhookAsync($"{WebhookBaseUrl}/compile", JsonUtility.ToJson(payload));
        }

        private static void OnAfterAssemblyReload()
        {
            var payload = new CompileEventPayload
            {
                instanceId = _instanceId,
                state = "finished",
                type = "compile",
                progress = 100,
                projectName = Application.productName,
                unityVersion = Application.unityVersion,
                success = true
            };
            SendWebhookAsync($"{WebhookBaseUrl}/compile", JsonUtility.ToJson(payload));
        }

        private static void OnAssemblyCompilationStarted(string assemblyPath)
        {
            int pct = s_TotalAssemblies > 0 ? (int)(100f * s_CompiledAssemblies / s_TotalAssemblies) : 0;
            var payload = new CompileEventPayload
            {
                instanceId = _instanceId,
                state = "started",
                type = "compile",
                progress = pct,
                projectName = Application.productName,
                unityVersion = Application.unityVersion
            };
            SendWebhookAsync($"{WebhookBaseUrl}/compile", JsonUtility.ToJson(payload));
        }

        private static void OnAssemblyCompilationFinished(string assemblyPath, CompilerMessage[] compilerMessages)
        {
            s_CompiledAssemblies++;
            int pct = s_TotalAssemblies > 0 ? (int)(100f * s_CompiledAssemblies / s_TotalAssemblies) : 100;
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

        /// <summary>
        /// Sends JSON payload via background ThreadPool so network requests are dispatched immediately 
        /// even when the Unity main thread is blocked executing a build pipeline.
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