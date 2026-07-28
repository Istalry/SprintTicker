import React, { useState, useEffect } from 'react';
import { MessageSquare, Save, Check, Send, Sparkles } from 'lucide-react';

export const MessagingView: React.FC = () => {
  // Discord State
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState<string>('https://discord.com/api/webhooks/demo');
  const [enableDiscordLed, setEnableDiscordLed] = useState<boolean>(true);

  // Slack State
  const [slackWebhookUrl, setSlackWebhookUrl] = useState<string>('https://hooks.slack.com/services/demo');
  const [enableSlackPreview, setEnableSlackPreview] = useState<boolean>(true);

  // Gmail State
  const [gmailQuery, setGmailQuery] = useState<string>('is:unread label:urgent');
  const [enableGmailLed, setEnableGmailLed] = useState<boolean>(true);

  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [testNotificationMessage, setTestNotificationMessage] = useState<string | null>(null);

  useEffect(() => {
    if (window.electronAPI?.getMessagingSettings) {
      window.electronAPI.getMessagingSettings().then(s => {
        if (s) {
          setDiscordWebhookUrl(s.discordWebhookUrl);
          setEnableDiscordLed(s.enableDiscordLed);
          setSlackWebhookUrl(s.slackWebhookUrl);
          setEnableSlackPreview(s.enableSlackPreview);
          setGmailQuery(s.gmailQuery);
          setEnableGmailLed(s.enableGmailLed);
        }
      }).catch(err => console.error('[MessagingView] Error fetching messaging settings:', err));
    }
  }, []);

  const handleSave = async () => {
    if (window.electronAPI?.saveMessagingSettings) {
      await window.electronAPI.saveMessagingSettings({
        discordWebhookUrl,
        enableDiscordLed,
        slackWebhookUrl,
        enableSlackPreview,
        gmailQuery,
        enableGmailLed
      });
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleSendTestAlert = async (channel: string) => {
    if (window.electronAPI?.testMessagingIntegration) {
      const res = await window.electronAPI.testMessagingIntegration(channel);
      setTestNotificationMessage(res.message);
    } else {
      setTestNotificationMessage(`Sent test notification payload to ${channel}!`);
    }
    setTimeout(() => setTestNotificationMessage(null), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl font-mono">
      {/* View Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center space-x-2">
            <MessageSquare className="w-5 h-5 text-accent-purple" />
            <span>THIRD-PARTY MESSAGING INTEGRATIONS</span>
          </h2>
          <p className="text-xs text-text-secondary">Configure Discord, Slack, and Gmail webhooks or API tokens for BUSY Bar front text banners and status LED alerts.</p>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center space-x-2 px-5 py-2.5 bg-accent-green hover:bg-emerald-600 text-dark-900 font-semibold text-sm rounded-lg shadow-md transition-all"
        >
          {savedSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>{savedSuccess ? 'Tokens Saved!' : 'Save Credentials'}</span>
        </button>
      </div>

      {testNotificationMessage && (
        <div className="p-4 bg-accent-purple/10 border border-accent-purple/30 rounded-xl text-xs text-accent-purple flex items-center justify-between">
          <span className="flex items-center space-x-2 font-bold">
            <Sparkles className="w-4 h-4" />
            <span>{testNotificationMessage}</span>
          </span>
          <span className="text-[10px] text-text-secondary">BUSY Bar Front Screen Test Preemption</span>
        </div>
      )}

      {/* Integration Cards Grid */}
      <div className="space-y-6">
        {/* Card 1: Discord Webhooks & Bot */}
        <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-[#5865F2]/20 border border-[#5865F2]/40 flex items-center justify-center font-bold text-[#5865F2]">
                D
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Discord Webhooks / Bot Integration</h3>
                <p className="text-xs text-text-secondary">Incoming high-priority mention alerts flash front LED in Purple (#8B5CF6).</p>
              </div>
            </div>

            <button
              onClick={() => handleSendTestAlert('Discord Webhook')}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-dark-900 hover:bg-dark-700 text-accent-purple border border-border-dark rounded-lg text-xs font-semibold transition-all"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Test Alert</span>
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Discord Webhook Endpoint URL</label>
              <input
                type="text"
                value={discordWebhookUrl}
                onChange={e => setDiscordWebhookUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-xs text-white focus:outline-none focus:border-accent-blue"
              />
            </div>

            <label className="flex items-center space-x-3 text-xs text-white cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enableDiscordLed}
                onChange={e => setEnableDiscordLed(e.target.checked)}
                className="rounded bg-dark-900 border-border-dark text-accent-blue focus:ring-0"
              />
              <span>Flash Purple LED Matrix on Discord urgent ping</span>
            </label>
          </div>
        </div>

        {/* Card 2: Slack Incoming Webhooks */}
        <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-[#E01E5A]/20 border border-[#E01E5A]/40 flex items-center justify-center font-bold text-[#E01E5A]">
                S
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Slack Workspace Integration</h3>
                <p className="text-xs text-text-secondary">Scroll sender preview text across front 72x16 LED display.</p>
              </div>
            </div>

            <button
              onClick={() => handleSendTestAlert('Slack Channel')}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-dark-900 hover:bg-dark-700 text-accent-purple border border-border-dark rounded-lg text-xs font-semibold transition-all"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Test Alert</span>
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Slack Incoming Webhook URL</label>
              <input
                type="text"
                value={slackWebhookUrl}
                onChange={e => setSlackWebhookUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-xs text-white focus:outline-none focus:border-accent-blue"
              />
            </div>

            <label className="flex items-center space-x-3 text-xs text-white cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enableSlackPreview}
                onChange={e => setEnableSlackPreview(e.target.checked)}
                className="rounded bg-dark-900 border-border-dark text-accent-blue focus:ring-0"
              />
              <span>Auto-scroll sender name &amp; message preview text on front display</span>
            </label>
          </div>
        </div>

        {/* Card 3: Gmail Urgent Filter Alerts */}
        <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-[#EA4335]/20 border border-[#EA4335]/40 flex items-center justify-center font-bold text-[#EA4335]">
                G
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Gmail API Urgent Email Monitor</h3>
                <p className="text-xs text-text-secondary">Preempt front display for urgent unread email queries.</p>
              </div>
            </div>

            <button
              onClick={() => handleSendTestAlert('Gmail API')}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-dark-900 hover:bg-dark-700 text-accent-purple border border-border-dark rounded-lg text-xs font-semibold transition-all"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Test Alert</span>
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Gmail Search Query Filter</label>
              <input
                type="text"
                value={gmailQuery}
                onChange={e => setGmailQuery(e.target.value)}
                placeholder="is:unread label:urgent"
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-xs text-white focus:outline-none focus:border-accent-blue"
              />
            </div>

            <label className="flex items-center space-x-3 text-xs text-white cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enableGmailLed}
                onChange={e => setEnableGmailLed(e.target.checked)}
                className="rounded bg-dark-900 border-border-dark text-accent-blue focus:ring-0"
              />
              <span>Flash Red LED Matrix on matching unread email</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessagingView;
