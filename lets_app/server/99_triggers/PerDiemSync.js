/**
 * PerDiemSync.js
 * Trigger installers/removers for the DoD + DOS per diem sync jobs. The
 * actual sync orchestration (syncDoDPerDiem / syncForeignPerDiem) lives
 * in 91_setup/{DoDSync,ForeignSync}.js — the trigger fires those functions
 * by name via GAS global resolution. Per Phase 4.9 the handler function
 * names must not change without reinstalling the trigger.
 */

// ============================================================================
// DOD PER DIEM SYNC TRIGGER
// ============================================================================

/**
 * Set up daily trigger for automatic DoD per diem sync. Runs at 6 AM.
 * Idempotent — removes existing trigger for syncDoDPerDiem before installing.
 *
 * @returns {{success: boolean, message: string}}
 * @editor
 */
function setupDoDSyncTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncDoDPerDiem') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('syncDoDPerDiem')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();

  console.log('DoD per diem sync trigger created (daily at 6 AM)');
  return { success: true, message: 'Daily sync trigger created' };
}

/**
 * Remove the DoD per diem sync trigger.
 * @returns {{success: boolean, removed: number}}
 * @editor
 */
function removeDoDSyncTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncDoDPerDiem') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });

  return { success: true, removed: removed };
}

// ============================================================================
// FOREIGN (DOS) PER DIEM SYNC TRIGGER
// ============================================================================

/**
 * Set up monthly trigger to auto-sync DOS per diem data. Runs on the 2nd
 * of each month at 6 AM (gives State Dept time to publish).
 * Idempotent.
 *
 * @returns {{success: boolean, message: string}}
 * @editor
 */
function setupForeignPerDiemTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncForeignPerDiem') {
      ScriptApp.deleteTrigger(trigger);
      console.log('Removed existing DOS sync trigger');
    }
  });

  ScriptApp.newTrigger('syncForeignPerDiem')
    .timeBased()
    .onMonthDay(2)
    .atHour(6)
    .create();

  console.log('Created monthly DOS per diem sync trigger (2nd of month, 6 AM)');
  return { success: true, message: 'Monthly trigger created for DOS per diem sync' };
}

/**
 * Remove the DOS per diem sync trigger.
 * @returns {{success: boolean, removed: number}}
 * @editor
 */
function removeForeignPerDiemTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncForeignPerDiem') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });

  console.log(`Removed ${removed} DOS sync trigger(s)`);
  return { success: true, removed: removed };
}
