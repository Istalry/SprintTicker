import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { IconAnimator, IconAnimatorDriver, ICON_ELEMENT_ID } from '../src/main/hardware/icon-animator';
import { AnimationData } from '../src/main/hardware/animation-sequence';
import { DeviceRequestError } from '../src/main/hardware/device-errors';
import { FRONT_LAYER_Z } from '../src/shared/device-constants';
import { ArgumentNullException } from '../src/shared/dtos';

const GEAR = 'icon_gear_16x16';
const BELL = 'icon_bell_16x16';

function sequence(name: string, withAnim = true): AnimationData {
  return {
    name,
    fps: 10,
    frames: [Buffer.from(`${name}-0`), Buffer.from(`${name}-1`), Buffer.from(`${name}-2`)],
    animBuffer: withAnim ? Buffer.from(`${name}.anim`) : undefined
  };
}

interface FakeDriver {
  uploadAsset: Mock<IconAnimatorDriver['uploadAsset']>;
  drawOverlay: Mock<IconAnimatorDriver['drawOverlay']>;
  removeDisplayElements: Mock<IconAnimatorDriver['removeDisplayElements']>;
}

function makeDriver(): FakeDriver {
  return {
    uploadAsset: vi.fn<IconAnimatorDriver['uploadAsset']>().mockResolvedValue(undefined),
    drawOverlay: vi.fn<IconAnimatorDriver['drawOverlay']>().mockResolvedValue('drawn'),
    removeDisplayElements: vi.fn<IconAnimatorDriver['removeDisplayElements']>().mockResolvedValue(undefined)
  };
}

const rejected = (status = 400): DeviceRequestError => new DeviceRequestError('rejected', 'test', status);

describe('IconAnimator', () => {
  let driver: ReturnType<typeof makeDriver>;
  let load: Mock<(name: string) => Promise<AnimationData | null>>;
  let animator: IconAnimator;
  let logSpies: Array<{ mockRestore: () => void }>;

  beforeEach(() => {
    driver = makeDriver();
    load = vi.fn(async (name: string): Promise<AnimationData | null> => sequence(name));
    animator = new IconAnimator(driver, load);
    logSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
    ];
  });

  afterEach(() => {
    animator.dispose();
    logSpies.forEach(spy => spy.mockRestore());
  });

  describe('constructor', () => {
    it('Constructor_NullDriver_ThrowsArgumentNullException', () => {
      expect(() => new IconAnimator(null as never, load)).toThrow(ArgumentNullException);
    });

    it('Constructor_NullLoader_ThrowsArgumentNullException', () => {
      expect(() => new IconAnimator(driver, null as never)).toThrow(ArgumentNullException);
    });
  });

  describe('show', () => {
    it('Show_NewIcon_UploadsItsAnimAndDrawsItAboveTheFrame', async () => {
      animator.show(GEAR);
      await animator.settled();

      expect(driver.uploadAsset).toHaveBeenCalledWith('sprintticker', `${GEAR}.anim`, Buffer.from(`${GEAR}.anim`));
      const [, elements] = driver.drawOverlay.mock.calls[0];
      expect(elements).toEqual([
        expect.objectContaining({
          id: ICON_ELEMENT_ID,
          type: 'animation',
          path: `${GEAR}.anim`,
          x: 0,
          y: 0,
          loop: true,
          z_index: FRONT_LAYER_Z.ICON
        })
      ]);
    });

    it('Show_SameIconOnEveryFrame_TouchesTheDeviceOnce', async () => {
      // The tracker redraws once a second; each redraw calls show().
      for (let i = 0; i < 5; i++) {
        animator.show(GEAR);
        await animator.settled();
      }

      expect(driver.uploadAsset).toHaveBeenCalledTimes(1);
      expect(driver.drawOverlay).toHaveBeenCalledTimes(1);
    });

    it('Show_IconShownAgainAfterAnother_DoesNotUploadItTwice', async () => {
      animator.show(GEAR);
      await animator.settled();
      animator.show(null);
      await animator.settled();
      animator.show(GEAR);
      await animator.settled();

      expect(driver.uploadAsset).toHaveBeenCalledTimes(1);
      expect(driver.drawOverlay).toHaveBeenCalledTimes(2);
    });

    it('Show_Null_RemovesOnlyTheIconElement', async () => {
      animator.show(GEAR);
      await animator.settled();
      animator.show(null);
      await animator.settled();

      expect(driver.removeDisplayElements).toHaveBeenCalledWith('sprintticker', [ICON_ELEMENT_ID]);
    });

    it('Show_NullWithNothingDrawn_MakesNoDeviceCall', async () => {
      animator.show(null);
      await animator.settled();

      expect(driver.removeDisplayElements).not.toHaveBeenCalled();
      expect(driver.drawOverlay).not.toHaveBeenCalled();
    });

    it('Show_SwitchToAnotherIcon_ReplacesItByIdWithoutARemoval', async () => {
      animator.show(GEAR);
      await animator.settled();
      animator.show(BELL);
      await animator.settled();

      // A draw merges by element id, so drawing the bell under the same id is
      // what replaces the gear.
      expect(driver.removeDisplayElements).not.toHaveBeenCalled();
      expect(driver.drawOverlay.mock.calls[1][1][0]).toMatchObject({ id: ICON_ELEMENT_ID, path: `${BELL}.anim` });
    });

    it('Show_ChangedTwiceWhileUploading_EndsOnTheLatest', async () => {
      let releaseUpload: () => void = () => undefined;
      driver.uploadAsset.mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            releaseUpload = resolve;
          })
      );

      animator.show(GEAR);
      await new Promise(resolve => setTimeout(resolve, 0));
      animator.show(null);
      animator.show(BELL);
      releaseUpload();
      await animator.settled();

      // The gear's upload finished, but nothing asked for the gear any more.
      expect(driver.drawOverlay).toHaveBeenCalledTimes(1);
      expect(driver.drawOverlay.mock.calls[0][1][0]).toMatchObject({ path: `${BELL}.anim` });
    });
  });

  describe('failure paths', () => {
    it('Show_UploadRefused_DoesNotDrawAndDoesNotRetry', async () => {
      driver.uploadAsset.mockRejectedValue(rejected(500));

      animator.show(GEAR);
      await animator.settled();
      animator.show(GEAR);
      await animator.settled();

      // The static icon in the frame stands in; asking again on every render
      // would re-send a file the device has already refused.
      expect(driver.drawOverlay).not.toHaveBeenCalled();
      expect(driver.uploadAsset).toHaveBeenCalledTimes(1);
    });

    it('Show_NoAnimFile_DoesNotTouchTheDevice', async () => {
      load.mockResolvedValue(sequence(GEAR, false));

      animator.show(GEAR);
      await animator.settled();

      expect(driver.uploadAsset).not.toHaveBeenCalled();
      expect(driver.drawOverlay).not.toHaveBeenCalled();
    });

    it('Show_AnimationMissingFromDisk_DoesNotTouchTheDevice', async () => {
      load.mockResolvedValue(null);

      animator.show(GEAR);
      await animator.settled();

      expect(driver.uploadAsset).not.toHaveBeenCalled();
    });

    it('Show_DisplayHeldElsewhere_TriesAgainOnTheNextShow', async () => {
      driver.drawOverlay.mockResolvedValueOnce('conflict');

      animator.show(GEAR);
      await animator.settled();
      animator.show(GEAR);
      await animator.settled();

      // A 409 is not a refusal: the next render gets the icon back once the
      // other application lets go.
      expect(driver.drawOverlay).toHaveBeenCalledTimes(2);
      expect(driver.uploadAsset).toHaveBeenCalledTimes(1);
    });

    it('Show_DrawRefusedRightAfterUpload_WritesTheIconOff', async () => {
      driver.drawOverlay.mockRejectedValue(rejected());

      animator.show(GEAR);
      await animator.settled();
      animator.show(null);
      await animator.settled();
      animator.show(GEAR);
      await animator.settled();

      expect(driver.drawOverlay).toHaveBeenCalledTimes(1);
    });

    it('Show_DrawOfAnEarlierUploadRefused_UploadsAgainOnce', async () => {
      animator.show(GEAR);
      await animator.settled();
      animator.show(null);
      await animator.settled();

      // As after a device reboot: the asset we uploaded is gone.
      driver.drawOverlay.mockRejectedValueOnce(rejected());
      animator.show(GEAR);
      await animator.settled();

      expect(driver.uploadAsset).toHaveBeenCalledTimes(2);
      expect(driver.drawOverlay).toHaveBeenCalledTimes(3);
    });

    it('Show_NullButTheDeviceNoLongerHasTheIcon_TreatsItAsRemoved', async () => {
      animator.show(GEAR);
      await animator.settled();
      // What firmware 1.2.4 answers for an element that is not there -- as
      // after a full-panel animation cleared the display first.
      driver.removeDisplayElements.mockRejectedValueOnce(rejected(400));

      animator.show(null);
      await animator.settled();
      animator.show(null);
      await animator.settled();

      expect(driver.removeDisplayElements).toHaveBeenCalledTimes(1);
    });

    it('Show_NullWhileTheDeviceIsUnreachable_TriesTheRemovalAgain', async () => {
      animator.show(GEAR);
      await animator.settled();
      driver.removeDisplayElements.mockRejectedValueOnce(new DeviceRequestError('unreachable', 'test'));

      animator.show(null);
      await animator.settled();
      animator.show(null);
      await animator.settled();

      // An icon left animating over the next screen is showing the wrong thing.
      expect(driver.removeDisplayElements).toHaveBeenCalledTimes(2);
    });

    it('Reset_AfterARefusal_GivesTheIconAnotherChance', async () => {
      driver.uploadAsset.mockRejectedValueOnce(rejected(500));
      animator.show(GEAR);
      await animator.settled();

      animator.reset();
      animator.show(null);
      animator.show(GEAR);
      await animator.settled();

      expect(driver.uploadAsset).toHaveBeenCalledTimes(2);
      expect(driver.drawOverlay).toHaveBeenCalledTimes(1);
    });

    it('Reset_AfterADeviceClear_DrawsAndUploadsAgain', async () => {
      animator.show(GEAR);
      await animator.settled();

      animator.reset();
      animator.show(GEAR);
      await animator.settled();

      expect(driver.uploadAsset).toHaveBeenCalledTimes(2);
      expect(driver.drawOverlay).toHaveBeenCalledTimes(2);
    });
  });

  describe('emulator preview', () => {
    it('Show_Icon_PreviewsTheFrameForTheElapsedTime', async () => {
      let now = 1000;
      const frames: Array<Buffer | null> = [];
      animator = new IconAnimator(driver, load, { onPreviewFrame: f => frames.push(f), now: () => now });

      animator.show(GEAR);
      await animator.settled();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(frames[0]?.toString()).toBe(`${GEAR}-0`);

      // 10 fps: 250 ms in is frame 2, whatever the preview's own tick rate.
      now += 250;
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(frames[frames.length - 1]?.toString()).toBe(`${GEAR}-2`);
    });

    it('Show_Null_ClearsThePreview', async () => {
      const frames: Array<Buffer | null> = [];
      animator = new IconAnimator(driver, load, { onPreviewFrame: f => frames.push(f) });

      animator.show(GEAR);
      await animator.settled();
      animator.show(null);

      expect(frames[frames.length - 1]).toBeNull();
    });

    it('Show_IconTheDeviceRefused_StopsPreviewingIt', async () => {
      // The emulator must show what the bar shows. A preview animating an icon
      // the bar is showing static is how the dark-bar bug stayed hidden.
      driver.uploadAsset.mockRejectedValue(rejected(500));
      const frames: Array<Buffer | null> = [];
      animator = new IconAnimator(driver, load, { onPreviewFrame: f => frames.push(f) });

      animator.show(GEAR);
      await animator.settled();

      expect(frames[frames.length - 1]).toBeNull();
    });
  });
});
