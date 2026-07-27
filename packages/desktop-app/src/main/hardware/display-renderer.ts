import { BusyBarDriver } from './busybar-driver';
import { ActiveSessionDTO } from '../../shared/dtos';

export interface DisplayPayload {
  frontElements: Array<Record<string, unknown>>;
  backElements: Array<Record<string, unknown>>;
  ledColorHex?: string;
}

/**
 * Service rendering hardware display screen payloads according to physical pixel templates.
 * Front Display (72x16 RGB LED): Active task tracking, compilation progress, ON AIR alerts.
 * Rear Display (160x80 OLED): Debug information and system metrics ONLY.
 */
export class DisplayRenderer {
  private driver: BusyBarDriver;

  constructor(driver: BusyBarDriver) {
    this.driver = driver;
  }

  private formatTime(totalSec: number): string {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Renders Template A: Active Task Tracker View on Front Display, and System Metrics on Rear OLED.
   */
  public renderActiveSession(session: ActiveSessionDTO | null): DisplayPayload {
    const elapsedText = session ? this.formatTime(session.elapsedSeconds) : '00:00:00';
    const row1Text = session ? `${session.taskKey} ${elapsedText}` : 'IDLE 00:00:00';
    const row2Text = session ? session.taskTitle : 'No Active Task Selected';

    const ledColor = session
      ? session.status === 'TRACKING'
        ? '#10B981FF' // Solid Green
        : '#F59E0BFF' // Breathing Yellow
      : '#2D3440FF'; // Off / Dim

    const payload: DisplayPayload = {
      frontElements: [
        {
          type: 'text',
          font: 'small',
          x: 0,
          y: 0,
          color: '#AAFF00FF',
          text: row1Text
        },
        {
          type: 'text',
          font: 'small',
          x: 0,
          y: 8,
          color: '#FFFFFFFF',
          text: row2Text,
          scroll_rate: 60
        }
      ],
      backElements: [
        {
          type: 'text',
          font: 'tiny',
          x: 0,
          y: 0,
          color: '#FFFFFF',
          text: 'BUSY BAR DIAGNOSTICS [USB Ethernet]'
        },
        {
          type: 'text',
          font: 'tiny',
          x: 0,
          y: 16,
          color: '#CCCCCC',
          text: `IP: ${this.driver.getDeviceStatus().ipAddress} | Ping: ${this.driver.getDeviceStatus().webSocketPingMs}ms`
        },
        {
          type: 'text',
          font: 'tiny',
          x: 0,
          y: 32,
          color: '#CCCCCC',
          text: `Active Task: ${session ? session.taskKey : 'NONE'} (${session ? session.status : 'IDLE'})`
        }
      ],
      ledColorHex: ledColor
    };

    this.driver.sendDisplayPayload(payload as unknown as Record<string, unknown>);
    return payload;
  }

  /**
   * Renders Template C: Unity Play Mode "ON AIR" Alert.
   */
  public renderPlayMode(projectName: string): DisplayPayload {
    const payload: DisplayPayload = {
      frontElements: [
        {
          type: 'text',
          font: 'bold',
          x: 12,
          y: 3,
          color: '#FF0000FF',
          text: 'ON AIR'
        },
        {
          type: 'text',
          font: 'tiny',
          x: 0,
          y: 11,
          color: '#3B82F6FF',
          text: projectName
        }
      ],
      backElements: [
        {
          type: 'text',
          font: 'tiny',
          x: 0,
          y: 0,
          color: '#FFFFFF',
          text: 'UNITY PLAY MODE ACTIVE'
        }
      ],
      ledColorHex: '#FF0000FF' // Solid Red LED
    };

    this.driver.sendDisplayPayload(payload as unknown as Record<string, unknown>);
    return payload;
  }

  /**
   * Renders Template B: Unity Compilation Progress Bar View.
   */
  public renderCompilation(projectName: string, progress: number = 50): DisplayPayload {
    const payload: DisplayPayload = {
      frontElements: [
        {
          type: 'text',
          font: 'small',
          x: 0,
          y: 0,
          color: '#3B82F6FF',
          text: `${projectName}: Compiling...`
        },
        {
          type: 'rectangle',
          x: 0,
          y: 9,
          width: Math.floor((progress * 72) / 100),
          height: 5,
          fill: '#3B82F6FF'
        }
      ],
      backElements: [
        {
          type: 'text',
          font: 'tiny',
          x: 0,
          y: 0,
          color: '#FFFFFF',
          text: `Compiling ${projectName} (${progress}%)`
        }
      ],
      ledColorHex: '#3B82F6FF' // Blinking Blue LED
    };

    this.driver.sendDisplayPayload(payload as unknown as Record<string, unknown>);
    return payload;
  }
}
