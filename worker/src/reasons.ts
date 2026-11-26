// Why a photo was refused (Docs/arquitetura.md, *Moderação*): a fixed list of
// codes, shown to the author on their uploads page and chosen by the
// moderator in the queue. The codes are the CHECK in migration 0014.
import type { Lang } from './pages.ts';

export const REASONS = ['wrong_station', 'privacy', 'quality', 'duplicate', 'advertising', 'other'] as const;
export type Reason = (typeof REASONS)[number];

export const isReason = (v: unknown): v is Reason => typeof v === 'string' && (REASONS as readonly string[]).includes(v);

// In plain words, for the author. «other» says to read the note, if any.
export const REASON_TEXT: Record<Lang, Record<Reason, string>> = {
  pt: {
    wrong_station: 'Não é deste posto ou tomada',
    privacy: 'Mostra dados pessoais (caras, matrículas, casas)',
    quality: 'Qualidade fraca (desfocada, escura ou cortada)',
    duplicate: 'Já temos uma foto igual ou muito parecida',
    advertising: 'Publicidade ou conteúdo que não é do posto',
    other: 'Outro motivo',
  },
  en: {
    wrong_station: 'Not of this station or socket',
    privacy: 'Shows personal data (faces, number plates, homes)',
    quality: 'Poor quality (blurry, dark or cropped)',
    duplicate: 'We already have the same or a very similar photo',
    advertising: 'Advertising or content not about the station',
    other: 'Other reason',
  },
};

// The note is the moderator's own short text, kept as plain text.
export function cleanNote(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  return s || null;
}

// Panoramax report categories → our reason, for removals by takedown.
export function reasonForReport(issue: string | undefined): Reason {
  switch (issue) {
    case 'blur_missing': case 'blur_excess': case 'privacy': case 'inappropriate': return 'privacy';
    case 'picture_low_quality': return 'quality';
    case 'mislocated': return 'wrong_station';
    default: return 'other';
  }
}

// <option>s of the reason select. No default: the moderator must choose.
export function reasonOptions(lang: Lang, placeholder: string): string {
  return `<option value="" selected disabled>${placeholder}</option>` +
    REASONS.map((r) => `<option value="${r}">${REASON_TEXT[lang][r]}</option>`).join('');
}
