import { InlineKeyboard } from "grammy";

// Onboarding is now a single question after the first entry: when to come back?
// 4 humanly-named presets, no fine-tuning chain. The user can adjust later in /settings.
export const REMINDER_PRESETS = [
  { code: "WEEKLY:7:21:00", label: "Воскресенье вечером" },
  { code: "WEEKLY:1:09:00", label: "Понедельник утром" },
  { code: "MONTHLY:1:21:00", label: "Раз в 2 недели" },
  { code: "MANUAL:0:00:00", label: "Только когда я сам(а)" }
] as const;

export function reminderPresetKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  REMINDER_PRESETS.forEach((preset, i) => {
    kb.text(preset.label, `onb:rmd:${preset.code}`);
    if (i < REMINDER_PRESETS.length - 1) kb.row();
  });
  return kb;
}
