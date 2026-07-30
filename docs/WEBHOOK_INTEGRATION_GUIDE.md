# 🔌 BUSY Bar Webhook Integration Guide

This guide explains how to connect **Discord**, **Slack**, and **Gmail** notifications to your **BUSY Bar PC Companion Application** using the embedded local Fastify Webhook Server (`http://127.0.0.1:39123`).

---

## 🛰️ Webhook Server Overview

The BUSY Bar PC Companion app hosts a local REST API endpoint server listening on port `39123`. When incoming messages or alerts arrive, the app triggers visual LED banners, front 72x16 matrix icons, and rear OLED previews according to your preemption matrix rules.

- **Base URL:** `http://127.0.0.1:39123`
- **Content-Type:** `application/json`

---

## 🟣 1. Discord Webhook Setup

### Incoming Mentions & Direct Alerts
You can forward Discord bot notifications or incoming webhook alerts to flash purple LED alerts (`#8B5CF6`) and display message previews on your physical display.

#### Endpoint
`POST http://127.0.0.1:39123/api/v1/discord/webhook`

#### Payload Format
```json
{
  "sender": "Alice#1234",
  "channel": "#general",
  "message": "Hey! Can you check the build status?",
  "priority": "high"
}
```

#### Curl Test Command
```bash
curl -X POST http://127.0.0.1:39123/api/v1/discord/webhook \
  -H "Content-Type: application/json" \
  -d "{\"sender\": \"Alice\", \"channel\": \"#dev\", \"message\": \"Build complete!\", \"priority\": \"high\"}"
```

---

## 🟢 2. Slack Webhook Setup

### Workspace Events & Notification Banners
Slack incoming webhooks or bot event subscriptions forward channel messages directly to the BUSY Bar matrix banner.

#### Endpoint
`POST http://127.0.0.1:39123/api/v1/slack/events`

#### Payload Format
```json
{
  "event": {
    "type": "message",
    "user": "U12345678",
    "text": "Code review requested for PR #42",
    "channel": "C87654321"
  },
  "senderName": "Bob (Slack)"
}
```

#### Curl Test Command
```bash
curl -X POST http://127.0.0.1:39123/api/v1/slack/events \
  -H "Content-Type: application/json" \
  -d "{\"senderName\": \"Bob\", \"event\": {\"type\": \"message\", \"text\": \"PR Ready for Review!\"}}"
```

---

## 🔴 3. Gmail Webhook & Notification Setup

### High-Priority Email Alerts
Forward important emails (e.g. build system alerts, customer tickets, or urgent emails) via Zapier, Make, or a custom script.

#### Endpoint
`POST http://127.0.0.1:39123/api/v1/messaging/alert`

#### Payload Format
```json
{
  "platform": "gmail",
  "sender": "alerts@github.com",
  "subject": "[Urgent] Build Failed on main branch",
  "preview": "Action required: pipeline #982 failed during integration test.",
  "importance": "high"
}
```

#### Curl Test Command
```bash
curl -X POST http://127.0.0.1:39123/api/v1/messaging/alert \
  -H "Content-Type: application/json" \
  -d "{\"platform\": \"gmail\", \"sender\": \"Boss\", \"subject\": \"Meeting in 5 mins\", \"importance\": \"high\"}"
```

---

## ⚙️ Priority Matrix & Mode Behavior

Incoming webhooks are automatically evaluated against your configured **Notification & Preemption Priority Matrix**:

- **WORK Mode:** Displays incoming message banners immediately.
- **LUNCH Mode:** Automatically suppresses non-critical chat notifications.
- **AWAY Mode:** Queues non-critical alerts for replay when you return to WORK mode.
