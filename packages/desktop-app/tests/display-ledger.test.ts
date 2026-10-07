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
    it('SettleRemainingMs_NoAnimationEverRemoved_IsZero', () => {
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

    it('SettleRemainingMs_ImageRemoved_DoesNotCount', () => {
      ledger.noteDrawn(APP, [frame]);
      ledger.noteRemoved(APP, ['px_matrix_img']);

      expect(ledger.settleRemainingMs(500)).toBe(0);
    });

    it('SettleRemainingMs_ClearTookAnAnimation_Counts', () => {
      ledger.noteDrawn(APP, [icon]);
      ledger.noteCleared(APP);

      expect(ledger.settleRemainingMs(500)).toBe(500);
    });
  });

  it('IsKnownAbsent_NoId_Throws', () => {
    expect(() => ledger.isKnownAbsent(APP, '')).toThrow();
  });
});
