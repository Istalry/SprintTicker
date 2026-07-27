using System;
using System.Text;
using System.Threading.Tasks;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;
using UnityEngine.Networking;

namespace Com.Antigravity.BusyBar.Editor
{
    /// <summary>
    /// Lightweight Unity Editor script that hooks into compilation events, Play Mode state transitions,
    /// and critical console exceptions, posting JSON telemetry webhooks to the Antigravity BUSY Bar PC Companion App.
    /// Gracefully degrades with 500ms request timeouts if the companion app is not running.
    /// </summary>
    [InitializeOnLoad]
    public static class BusyBarWebhookPublisher
    {
        private const string WebhookBaseUrl = "http://127.0.0.1:39123/api/v1/unity";
        private const int RequestTimeoutSeconds = 1;

        static BusyBarWebhookPublisher()
        {
            // Subscribe to Unity Editor events
            CompilationPipeline.assemblyCompilationStarted += OnAssemblyCompilationStarted;
            CompilationPipeline.assemblyCompilationFinished += OnAssemblyCompilationFinished;
            EditorApplication.playModeStateChanged += OnPlayModeStateChanged;
            Application.logMessageReceivedThreaded += OnLogMessageReceived;
        }

        private static void OnAssemblyCompilationStarted(string assemblyPath)
        {
            var payload = new CompileEventPayload
            {
                state = "started",
                projectName = Application.productName,
                unityVersion = Application.unityVersion
            };
            SendWebhookAsync($"{WebhookBaseUrl}/compile", JsonUtility.ToJson(payload));
        }

        private static void OnAssemblyCompilationFinished(string assemblyPath, CompilerMessage[] compilerMessages)
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

            var payload = new CompileEventPayload
            {
                state = "finished",
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
            if (state == PlayModeStateChange.EnteredPlayMode || state == PlayModeStateChange.ExitingPlayMode)
            {
                var payload = new PlayModeEventPayload
                {
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
                    type = (type == LogType.Exception) ? "exception" : "error",
                    message = condition,
                    stackTrace = stackTrace,
                    projectName = Application.productName
                };
                SendWebhookAsync($"{WebhookBaseUrl}/console", JsonUtility.ToJson(payload));
            }
        }

        /// <summary>
        /// Asynchronously posts JSON payload to Fastify Webhook Server with short timeout.
        /// Catches and suppresses all network errors to guarantee non-blocking execution.
        /// </summary>
        private static async void SendWebhookAsync(string url, string jsonBody)
        {
            try {
                using (var request = new UnityWebRequest(url, "POST"))
                {
                    byte[] bodyRaw = Encoding.UTF8.GetBytes(jsonBody);
                    request.uploadHandler = new UploadHandlerRaw(bodyRaw);
                    request.downloadHandler = new DownloadHandlerBuffer();
                    request.SetRequestHeader("Content-Type", "application/json");
                    request.timeout = RequestTimeoutSeconds;

                    var operation = request.SendWebRequest();
                    while (!operation.isDone)
                    {
                        await Task.Delay(50);
                    }

                    if (request.result != UnityWebRequest.Result.Success)
                    {
                        // Quiet debug output if companion server is offline
                        // Debug.LogWarning($"[BUSYBarPublisher] Webhook request to {url} degraded: {request.error}");
                    }
                }
            }
            catch (Exception ex)
            {
                // Suppress exception to ensure Unity compilation loop is never interrupted
                _ = ex;
            }
        }

        [Serializable]
        private class CompileEventPayload
        {
            public string state;
            public string projectName;
            public string unityVersion;
            public bool success;
            public int errorCount;
            public int warningCount;
        }

        [Serializable]
        private class PlayModeEventPayload
        {
            public string state;
            public string projectName;
        }

        [Serializable]
        private class ConsoleEventPayload
        {
            public string type;
            public string message;
            public string stackTrace;
            public string projectName;
        }
    }
}
