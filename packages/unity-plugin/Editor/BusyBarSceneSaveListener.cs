using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Com.Antigravity.BusyBar.Editor
{
    /// <summary>
    /// Lightweight HTTP listener running inside Unity Editor listening on http://localhost:8081/antigravity/save-scenes/
    /// (or fallback ports 8082-8089 for multi-instance support).
    /// Architectural Rationale: Responds to RPC scene save requests triggered during PC Companion App End-of-Day wrap-up
    /// so developer work is safely committed to disk before PC shutdown sequence completes.
    /// </summary>
    [InitializeOnLoad]
    public static class BusyBarSceneSaveListener
    {
        private const int StartingPort = 8081;
        private const int MaxPortOffset = 8;
        private static HttpListener _httpListener;
        private static Thread _listenerThread;
        private static readonly Queue<Action> _mainThreadQueue = new Queue<Action>();

        /// <summary>
        /// Gets the local HTTP port bound by this Unity Editor instance for scene save RPC requests.
        /// Why: Allows multi-instance Editor setups to broadcast their distinct RPC port back to the companion app.
        /// </summary>
        public static int BoundPort { get; private set; } = StartingPort;

        static BusyBarSceneSaveListener()
        {
            EditorApplication.update += ProcessMainThreadQueue;
            AssemblyReloadEvents.beforeAssemblyReload += StopHttpListener;
            EditorApplication.quitting += StopHttpListener;
            AppDomain.CurrentDomain.DomainUnload += OnDomainUnload;

            StartHttpListener();
        }

        private static void OnDomainUnload(object sender, EventArgs e)
        {
            StopHttpListener();
        }

        /// <summary>
        /// Binds an HttpListener on the first available port between StartingPort and StartingPort + MaxPortOffset.
        /// Why: Ensures multi-instance Unity Editors automatically assign unique non-conflicting RPC ports.
        /// </summary>
        private static void StartHttpListener()
        {
            if (_httpListener != null && _httpListener.IsListening) return;

            for (int portOffset = 0; portOffset <= MaxPortOffset; portOffset++)
            {
                int candidatePort = StartingPort + portOffset;
                if (TryBindPort(candidatePort)) return;
            }

            Debug.LogWarning($"[BUSYBarSceneSaveListener] Unable to bind scene save listener on ports {StartingPort}-{StartingPort + MaxPortOffset}.");
        }

        private static bool TryBindPort(int candidatePort)
        {
            string prefix = $"http://localhost:{candidatePort}/antigravity/save-scenes/";
            try
            {
                var listener = new HttpListener();
                listener.Prefixes.Add(prefix);
                listener.Start();

                _httpListener = listener;
                BoundPort = candidatePort;

                _listenerThread = new Thread(ListenLoop)
                {
                    IsBackground = true
                };
                _listenerThread.Start();
                Debug.Log($"[BUSYBarSceneSaveListener] Listening for EOD scene save commands on {prefix}");
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// Gracefully stops the HTTP listener and terminates the background thread before domain reload or app exit.
        /// Why: Prevents port binding collisions and native OS socket leaks across Mono domain reloads.
        /// </summary>
        public static void StopHttpListener()
        {
            try
            {
                if (_httpListener != null)
                {
                    if (_httpListener.IsListening)
                    {
                        _httpListener.Stop();
                    }
                    _httpListener.Close();
                    _httpListener = null;
                }
            }
            catch (Exception)
            {
                // Suppress cleanup exceptions during domain reload or exit
            }
        }

        private static void ListenLoop()
        {
            while (_httpListener != null && _httpListener.IsListening)
            {
                try
                {
                    var context = _httpListener.GetContext();
                    ProcessRequestAsync(context);
                }
                catch (HttpListenerException)
                {
                    break;
                }
                catch (ObjectDisposedException)
                {
                    break;
                }
                catch (ThreadAbortException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[BUSYBarSceneSaveListener] Request listener error: {ex.Message}");
                }
            }
        }

        private static void ProcessRequestAsync(HttpListenerContext context)
        {
            if (context.Request.HttpMethod == "POST")
            {
                HandlePostRequest(context);
            }
            else
            {
                context.Response.StatusCode = 405;
                context.Response.Close();
            }
        }

        private static void HandlePostRequest(HttpListenerContext context)
        {
            var resetEvent = new AutoResetEvent(false);
            var savedScenesList = new List<string>();

            lock (_mainThreadQueue)
            {
                _mainThreadQueue.Enqueue(() => PerformSceneSave(savedScenesList, resetEvent));
            }

            resetEvent.WaitOne(1800);
            SendJsonResponse(context, savedScenesList);
        }

        private static void PerformSceneSave(List<string> savedScenesList, AutoResetEvent resetEvent)
        {
            try
            {
                var count = UnityEngine.SceneManagement.SceneManager.loadedSceneCount;
                for (int i = 0; i < count; i++)
                {
                    var scene = EditorSceneManager.GetSceneAt(i);
                    if (scene.isDirty)
                    {
                        savedScenesList.Add(scene.path);
                    }
                }
                EditorSceneManager.SaveOpenScenes();
            }
            catch (Exception ex)
            {
                Debug.LogError($"[BUSYBarSceneSaveListener] Error saving scenes on main thread: {ex.Message}");
            }
            finally
            {
                resetEvent.Set();
            }
        }

        private static void SendJsonResponse(HttpListenerContext context, List<string> savedScenesList)
        {
            var responseJson = JsonUtility.ToJson(new SaveResponse
            {
                result = "OK",
                savedScenes = savedScenesList.ToArray()
            });

            byte[] responseBytes = Encoding.UTF8.GetBytes(responseJson);
            context.Response.ContentType = "application/json";
            context.Response.StatusCode = 200;
            context.Response.ContentLength64 = responseBytes.Length;
            context.Response.OutputStream.Write(responseBytes, 0, responseBytes.Length);
            context.Response.OutputStream.Close();
        }

        private static void ProcessMainThreadQueue()
        {
            lock (_mainThreadQueue)
            {
                while (_mainThreadQueue.Count > 0)
                {
                    var action = _mainThreadQueue.Dequeue();
                    action?.Invoke();
                }
            }
        }

        [Serializable]
        private class SaveResponse
        {
            public string result;
            public string[] savedScenes;
        }
    }
}
