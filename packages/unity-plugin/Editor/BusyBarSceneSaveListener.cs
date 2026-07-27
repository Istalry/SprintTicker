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
    /// Lightweight HTTP listener running inside Unity Editor listening on http://localhost:8081/antigravity/save-scenes.
    /// Responds to RPC scene save requests triggered during PC Companion App End-of-Day wrap-up.
    /// </summary>
    [InitializeOnLoad]
    public static class BusyBarSceneSaveListener
    {
        private const string ListenerPrefix = "http://localhost:8081/antigravity/save-scenes/";
        private static HttpListener _httpListener;
        private static Thread _listenerThread;
        private static readonly Queue<Action> MainThreadQueue = new Queue<Action>();

        static BusyBarSceneSaveListener()
        {
            EditorApplication.update += ProcessMainThreadQueue;
            StartHttpListener();
        }

        private static void StartHttpListener()
        {
            try
            {
                if (_httpListener != null && _httpListener.IsListening) return;

                _httpListener = new HttpListener();
                _httpListener.Prefixes.Add(ListenerPrefix);
                _httpListener.Start();

                _listenerThread = new Thread(ListenLoop)
                {
                    IsBackground = true
                };
                _listenerThread.Start();
                Debug.Log("[BUSYBarSceneSaveListener] Listening for EOD scene save commands on http://localhost:8081/antigravity/save-scenes");
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[BUSYBarSceneSaveListener] Unable to bind port 8081: {ex.Message}");
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
                    // Listener closed or aborted
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
                var resetEvent = new AutoResetEvent(false);
                var savedScenesList = new List<string>();

                // Queue main thread scene saving
                lock (MainThreadQueue)
                {
                    MainThreadQueue.Enqueue(() =>
                    {
                        try
                        {
                            var count = EditorSceneManager.loadedSceneCount;
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
                    });
                }

                // Wait up to 1800ms for main thread execution
                resetEvent.WaitOne(1800);

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
            else
            {
                context.Response.StatusCode = 405;
                context.Response.Close();
            }
        }

        private static void ProcessMainThreadQueue()
        {
            lock (MainThreadQueue)
            {
                while (MainThreadQueue.Count > 0)
                {
                    var action = MainThreadQueue.Dequeue();
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
