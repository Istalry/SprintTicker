import { describe, it, expect, beforeEach } from 'vitest';
import { DisplayLedger } from '../src/main/hardware/display-ledger';

describe('DisplayLedger', () => {
  const APP = 'sprintticker';
  const frame = { id: 'px_matrix_img', type: 'image', path: 'frame.png' };
  const icon = { id: 'icon_anim', type: 'animation', path: 'icon_gear_16x16.anim' };
  let now: number;
  let ledger: DisplayLedger;

  beforeEach(() => {
    now = 1_000;
    ledger = new DisplayLedger(() => now);
  });

  describe('before any clear', () => {
    it('IsKnownAbsent_NeverCleared_IsFalse', () => {
      // A previous run may have left the icon up; only a clear vouches for the panel.
      expect(ledger.isKnownAbsent(APP, 'icon_anim')).toBe(false);
    });

    it('IsKnownEmpty_NeverCleared_IsFalse', () => {
      ledger.noteDrawn(APP, [frame]);
      ledger.noteRemoved(APP, ['px_matrix_img']);

      expect(ledger.isKnownEmpty(APP)).toBe(false);
    });
  });

  describe('after a clear', () => {
    beforeEach(() => ledger.noteCleared(APP));

    it('IsKnownEmpty_NothingDrawnSince_IsTrue', () => {
      expect(ledger.isKnownEmpty(APP)).toBe(true);
    });

    it('IsKnownEmpty_DrawnSince_IsFalse', () => {
      ledger.noteDrawn(APP, [frame]);

      expect(ledger.isKnownEmpty(APP)).toBe(false);
    });

    it('IsKnownEmpty_LastElementRemoved_IsTrueAgain', () => {
      ledger.noteDrawn(APP, [frame]);
      ledger.noteRemoved(APP, ['px_matrix_img']);

      expect(ledger.isKnownEmpty(APP)).toBe(true);
    });

    it('IsKnownAbsent_NotDrawnSince_IsTrue', () => {
      ledger.noteDrawn(APP, [frame]);

      expect(ledger.isKnownAbsent(APP, 'icon_anim')).toBe(true);
      expect(ledger.isKnownAbsent(APP, 'px_matrix_img')).toBe(false);
    });

    it('NoteDrawUncertain_DrawGotNoAnswer_NoLongerVouchesForThePanel', () => {
      // It may have landed: the icon may be up, and an empty panel is no longer certain.
      ledger.noteDrawUncertain(APP, [icon]);
      ledger.noteRemoved(APP, ['icon_anim']);

      expect(ledger.isKnownEmpty(APP)).toBe(false);
      expect(ledger.isKnownAbsent(APP, 'px_matrix_img')).toBe(false);
    });

    it('NoteClearUncertain_ClearGotNoAnswer_NoLongerVouchesForThePanel', () => {
      ledger.noteClearUncertain(APP);

      expect(ledger.isKnownEmpty(APP)).toBe(false);
    });

    it('ForgetAll_AnotherDevice_NoLongerVouchesForAnything', () => {
      ledger.forgetAll();

      expect(ledger.isKnownEmpty(APP)).toBe(false);
    });
  });

  it('Ids_ByType_ListsOnlyThatType', () => {
    ledger.noteDrawn(APP, [frame, icon]);

    expect(ledger.ids(APP, 'animation')).toEqual(['icon_anim']);
    expect(ledger.ids(APP).sort()).toEqual(['icon_anim', 'px_matrix_img']);
    expect(ledger.ids('other_app')).toEqual([]);
  });

  it('IsPlaying_AnimationOnThePanel_MatchesItsFile', () => {
    ledger.noteDrawn(APP, [frame, icon]);

    expect(ledger.isPlaying(APP, 'icon_gear_16x16.anim')).toBe(true);
    // An image showing a file is not playing it: uploading over it is fine.
    expect(ledger.isPlaying(APP, 'frame.png')).toBe(false);
  });

  it('CouldEmpty_RemovingTheLastListedElement_IsTrueEvenWhenUnknown', () => {
    ledger.noteDrawn(APP, [frame, icon]);

    expect(ledger.couldEmpty(APP, ['icon_anim'])).toBe(false);
    expect(ledger.couldEmpty(APP, ['icon_anim', 'px_matrix_img'])).toBe(true);
    expect(ledger.couldEmpty('never_drawn', ['anything'])).toBe(true);
  });

  describe('settle', () => {
    it('SettleRemainingMs_NothingEverRemoved_IsZero', () => {
      expect(ledger.settleRemainingMs(500)).toBe(0);
    });

    it('SettleRemainingMs_AnimationJustRemoved_CountsDownFromTheRemoval', () => {
      ledger.noteDrawn(APP, [frame, icon]);
      ledger.noteRemoved(APP, ['icon_anim']);

      expect(ledger.settleRemainingMs(500)).toBe(500);
      now += 320;
      expect(ledger.settleRemainingMs(500)).toBe(180);
      now += 500;
      expect(ledger.settleRemainingMs(500)).toBe(0);
    });

    it('SettleRemainingMs_ImageRemoved_Counts', () => {
      // The release measured safe removed the frame, then waited, then closed.
      ledger.noteDrawn(APP, [frame, icon]);
      ledger.noteRemoved(APP, ['px_matrix_img']);

      expect(ledger.settleRemainingMs(500)).toBe(500);
    });

    it('SettleRemainingMs_UnlistedIdAbsentOnTheDevice_DoesNotCount', () => {
      ledger.noteDrawn(APP, [frame]);
      ledger.noteRemoved(APP, ['never_drawn']);

      expect(ledger.settleRemainingMs(500)).toBe(0);
    });

    it('SettleRemainingMs_UnlistedIdTheDeviceRemoved_Counts', () => {
      // A frame left by a previous run: this ledger never listed it, the
      // device still took it off the panel.
      ledger.noteRemoved(APP, ['px_matrix_img'], true);

      expect(ledger.settleRemainingMs(500)).toBe(500);
    });

    it('SettleRemainingMs_AnimationPutToRest_Counts', () => {
      ledger.noteDrawn(APP, [frame, icon]);
      ledger.noteParked(APP, 'icon_anim', 'blank.anim');

      expect(ledger.settleRemainingMs(500)).toBe(500);
    });

    it('SettleRemainingMs_AClear_DoesNotCount', () => {
      // A close is what the settle protects, not something to wait after.
      ledger.noteDrawn(APP, [icon]);
      ledger.noteCleared(APP);

      expect(ledger.settleRemainingMs(500)).toBe(0);
    });
  });

  describe('animations put to rest', () => {
    it('NoteParked_ListedAnimation_StaysListedWithTheEmptyPathAndItsLayer', () => {
      ledger.noteDrawn(APP, [frame, { ...icon, z_index: 2 }]);

      ledger.noteParked(APP, 'icon_anim', 'blank.anim');

      expect(ledger.element(APP, 'icon_anim')).toEqual({ type: 'animation', path: 'blank.anim', zIndex: 2 });
      expect(ledger.ids(APP, 'animation')).toEqual(['icon_anim']);
      expect(ledger.isPlaying(APP, 'icon_gear_16x16.anim')).toBe(false);
    });

    it('NoteParked_UnlistedId_IsListedAsAnAnimation', () => {
      ledger.noteParked(APP, 'hardware_anim', 'blank.anim');

      expect(ledger.element(APP, 'hardware_anim')?.type).toBe('animation');
      expect(ledger.isKnown(APP)).toBe(false);
    });

    it('IsPlaying_DrawOverItGotNoAnswer_StillCountsTheFileItReplaced', () => {
      // Found by the stress test: the bar dropped out under the gear, the
      // driver's draw of the ON AIR icon got no answer, and on the bar's
      // return the upload over the gear -- still playing -- answered 508.
      ledger.noteDrawn(APP, [icon]);

      ledger.noteDrawUncertain(APP, [{ ...icon, path: 'icon_playmode_16x16.anim' }]);

      expect(ledger.isPlaying(APP, 'icon_gear_16x16.anim')).toBe(true);
      expect(ledger.isPlaying(APP, 'icon_playmode_16x16.anim')).toBe(true);
    });

    it('IsPlaying_ConfirmedDrawAfterAnUncertainOne_ForgetsTheOldFile', () => {
      ledger.noteDrawn(APP, [icon]);
      ledger.noteDrawUncertain(APP, [{ ...icon, path: 'icon_playmode_16x16.anim' }]);

      ledger.noteDrawn(APP, [{ ...icon, path: 'icon_playmode_16x16.anim' }]);

      expect(ledger.isPlaying(APP, 'icon_gear_16x16.anim')).toBe(false);
    });

    it('Element_NotListed_IsUndefined', () => {
      expect(ledger.element(APP, 'icon_anim')).toBeUndefined();
    });

    it('IsKnown_AfterAClear_IsTrueUntilForgotten', () => {
      expect(ledger.isKnown(APP)).toBe(false);
      ledger.noteCleared(APP);
      expect(ledger.isKnown(APP)).toBe(true);
      ledger.forgetAll();
      expect(ledger.isKnown(APP)).toBe(false);
    });
  });

  it('IsKnownAbsent_NoId_Throws', () => {
    expect(() => ledger.isKnownAbsent(APP, '')).toThrow();
  });
});
