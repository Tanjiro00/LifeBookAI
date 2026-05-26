import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { t } from "../lib/i18n.js";

// Onboarding is now a single question after the first entry: when to come back?
// 4 humanly-named presets, no fine-tuning chain. The user can adjust later in /settings.
export const REMINDER_PRESETS = [
  { code: "WEEKLY:7:21:00", ru: "Воскресенье вечером", en: "Sunday evening" },
  { code: "WEEKLY:1:09:00", ru: "Понедельник утром", en: "Monday morning" },
  { code: "MONTHLY:1:21:00", ru: "Раз в 2 недели", en: "Every other week" },
  { code: "MANUAL:0:00:00", ru: "Только когда я сам(а)", en: "Only when I want to" }
] as const;

export function reminderPresetKeyboard(ctx?: Context): InlineKeyboard {
  const kb = new InlineKeyboard();
  REMINDER_PRESETS.forEach((preset, i) => {
    kb.text(t(ctx, preset.ru, preset.en), `onb:rmd:${preset.code}`);
    if (i < REMINDER_PRESETS.length - 1) kb.row();
  });
  return kb;
}
