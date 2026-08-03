using System;
using NUnit.Framework;
using UnityEngine;
using Com.Antigravity.BusyBar.Editor;

namespace Com.Antigravity.BusyBar.Editor.Tests
{
    /// <summary>
    /// Unit test suite validating telemetry payload JSON serialization, port binding initialization,
    /// and exception filtering for the Antigravity BUSY Bar Unity Editor plugin.
    /// </summary>
    [TestFixture]
    public class BusyBarPluginTests
    {
        /// <summary>
        /// Validates that HeartbeatEventPayload serializes into valid JSON with expected keys.
        /// </summary>
        [Test]
        public void SerializeHeartbeatPayload_ValidFields_ReturnsExpectedJson()
        {
            var payload = new BusyBarWebhookPublisher.HeartbeatEventPayload
            {
                instanceId = "MyGame_1234",
                projectName = "MyGame",
                unityVersion = "2022.3.10f1",
                compiling = false,
                playMode = true,
                savePort = 8081
            };

            string json = JsonUtility.ToJson(payload);

            Assert.IsNotNull(json);
            Assert.IsTrue(json.Contains("\"instanceId\":\"MyGame_1234\""));
            Assert.IsTrue(json.Contains("\"projectName\":\"MyGame\""));
            Assert.IsTrue(json.Contains("\"savePort\":8081"));
        }

        /// <summary>
        /// Validates that CompileEventPayload correctly formats compilation progress and error counts.
        /// </summary>
        [Test]
        public void SerializeCompilePayload_CompileStarted_ReturnsExpectedJson()
        {
            var payload = new BusyBarWebhookPublisher.CompileEventPayload
            {
                instanceId = "MyGame_1234",
                state = "started",
                type = "compile",
                progress = 45,
                projectName = "MyGame",
                unityVersion = "2022.3.10f1",
                success = true,
                errorCount = 0,
                warningCount = 2
            };

            string json = JsonUtility.ToJson(payload);

            Assert.IsNotNull(json);
            Assert.IsTrue(json.Contains("\"state\":\"started\""));
            Assert.IsTrue(json.Contains("\"progress\":45"));
            Assert.IsTrue(json.Contains("\"warningCount\":2"));
        }

        /// <summary>
        /// Validates that PlayModeEventPayload serializes state transitions cleanly.
        /// </summary>
        [Test]
        public void SerializePlayModePayload_EnteredPlayMode_ReturnsExpectedJson()
        {
            var payload = new BusyBarWebhookPublisher.PlayModeEventPayload
            {
                instanceId = "MyGame_1234",
                state = "entered",
                projectName = "MyGame"
            };

            string json = JsonUtility.ToJson(payload);

            Assert.IsNotNull(json);
            Assert.IsTrue(json.Contains("\"state\":\"entered\""));
            Assert.IsTrue(json.Contains("\"projectName\":\"MyGame\""));
        }

        /// <summary>
        /// Validates that ConsoleEventPayload accurately captures exception conditions.
        /// </summary>
        [Test]
        public void SerializeConsolePayload_NullReferenceException_ReturnsExpectedJson()
        {
            var payload = new BusyBarWebhookPublisher.ConsoleEventPayload
            {
                instanceId = "MyGame_1234",
                type = "exception",
                message = "NullReferenceException: Object reference not set to an instance of an object",
                stackTrace = "at PlayerController.Update () [0x00012] in Assets/Scripts/PlayerController.cs:42",
                projectName = "MyGame"
            };

            string json = JsonUtility.ToJson(payload);

            Assert.IsNotNull(json);
            Assert.IsTrue(json.Contains("\"type\":\"exception\""));
            Assert.IsTrue(json.Contains("NullReferenceException"));
        }

        /// <summary>
        /// Validates that the Scene Save Listener initializes and assigns a valid bound port (8081-8089).
        /// </summary>
        [Test]
        public void SceneSaveListener_Initialization_BindsValidPort()
        {
            int boundPort = BusyBarSceneSaveListener.BoundPort;
            Assert.GreaterOrEqual(boundPort, 8081);
            Assert.LessOrEqual(boundPort, 8089);
        }

        /// <summary>
        /// Validates that CompileEventPayload correctly formats failed builds with non-zero error counts.
        /// </summary>
        [Test]
        public void SerializeCompilePayload_FailedBuild_ReturnsExpectedJson()
        {
            var payload = new BusyBarWebhookPublisher.CompileEventPayload
            {
                instanceId = "MyGame_1234",
                state = "finished",
                type = "compile",
                progress = 100,
                projectName = "MyGame",
                unityVersion = "2022.3.10f1",
                success = false,
                errorCount = 3,
                warningCount = 5
            };

            string json = JsonUtility.ToJson(payload);

            Assert.IsNotNull(json);
            Assert.IsTrue(json.Contains("\"success\":false"));
            Assert.IsTrue(json.Contains("\"errorCount\":3"));
        }

        /// <summary>
        /// Validates that ConsoleEventPayload handles empty log messages without throwing.
        /// </summary>
        [Test]
        public void SerializeConsolePayload_EmptyMessage_HandlesGracefully()
        {
            var payload = new BusyBarWebhookPublisher.ConsoleEventPayload
            {
                instanceId = "MyGame_1234",
                type = "error",
                message = string.Empty,
                stackTrace = string.Empty,
                projectName = "MyGame"
            };

            string json = JsonUtility.ToJson(payload);

            Assert.IsNotNull(json);
            Assert.IsTrue(json.Contains("\"type\":\"error\""));
        }
    }
}
