import { type ImportBundle, contentKey } from './records';
import type { Snapshot } from './snapshot';
import { CLASS_RATINGS, CLASS_RATING_LABELS, MEDICAL_CLASS_LABELS } from './types';

/**
 * Preview of a "replace everything" restore: what would be added, changed, left alone, and REMOVED
 * (records that exist on this device but are not in the snapshot). Records are matched by id, because
 * a replace restores the snapshot exactly as it was.
 */
export interface KindDiff {
  added: number;
  changed: number;
  unchanged: number;
  removed: number;
}

export interface ReplacePlan {
  flights: KindDiff;
  fstd: KindDiff;
  experience: KindDiff;
  /** Holder details and licence dates the restore would set, change or clear. */
  licence: LicenceChange[];
  /** True if applying the restore would delete or change anything on this device. */
  destructive: boolean;
}

type LicenceData = Snapshot['settings'];

/**
 * The holder details and licence dates this logbook holds after a "replace everything" restore. The holder
 * details are kept where the snapshot has none; every date becomes the snapshot's, even if that is nothing.
 * Used both to apply the restore and to preview it, so the preview cannot say something else than happens.
 */
export function licenceAfterReplace(incoming: LicenceData, current: LicenceData) {
  return {
    pilotName: incoming.pilotName ?? current.pilotName,
    licenceNumber: incoming.licenceNumber ?? current.licenceNumber,
    address: incoming.address ?? current.address,
    sepLandExpiry: incoming.sepLandExpiry ?? null,
    classExpiry: incoming.classExpiry ?? {},
    irExpiry: incoming.irExpiry ?? null,
    medicalClass: incoming.medicalClass ?? null,
    medicalExpiry: incoming.medicalExpiry ?? null,
    languageLevel: incoming.languageLevel ?? null,
    languageExpiry: incoming.languageExpiry ?? null,
    typeRatings: incoming.typeRatings ?? [],
  } satisfies LicenceData;
}

export interface LicenceChange {
  label: string;
  /** Empty when there is nothing there now / nothing there afterwards. */
  from: string;
  to: string;
}

/** Each holder detail and licence date as readable text, keyed so two logbooks can be compared. */
function licenceEntries(d: LicenceData): Map<string, { label: string; value: string }> {
  const out = new Map<string, { label: string; value: string }>();
  const put = (key: string, label: string, value: string | number | null | undefined) => { if (value) out.set(key, { label, value: String(value) }); };
  put('pilotName', "Holder's name", d.pilotName);
  put('licenceNumber', 'Licence number', d.licenceNumber);
  put('address', 'Address', d.address);
  for (const c of CLASS_RATINGS) put(`class:${c}`, `${CLASS_RATING_LABELS[c]} expiry`, c === 'SEP_LAND' ? d.sepLandExpiry : d.classExpiry?.[c]);
  put('ir', 'Instrument rating expiry', d.irExpiry);
  put('medicalClass', 'Medical class', d.medicalClass && MEDICAL_CLASS_LABELS[d.medicalClass]);
  put('medical', 'Medical expiry', d.medicalExpiry);
  put('languageLevel', 'Language level', d.languageLevel);
  put('language', 'Language endorsement expiry', d.languageExpiry);
  // by id: flights point at it, so the same name under another id is a different rating
  for (const t of d.typeRatings ?? []) put(`type:${t.id}`, `Type rating ${t.name}`, `${t.name}, expires ${t.expiry}`);
  return out;
}

function licenceChanges(incoming: LicenceData, current: LicenceData): LicenceChange[] {
  const before = licenceEntries(current), after = licenceEntries(licenceAfterReplace(incoming, current));
  const out: LicenceChange[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(key), b = after.get(key);
    if (a?.value !== b?.value) out.push({ label: (b ?? a)!.label, from: a?.value ?? '', to: b?.value ?? '' });
  }
  return out;
}

function diff<T extends { id: string }>(incoming: T[], existing: T[]): KindDiff {
  const ex = new Map(existing.map((e) => [e.id, e]));
  const inc = new Set(incoming.map((i) => i.id));
  let added = 0, changed = 0, unchanged = 0;
  for (const i of incoming) {
    const e = ex.get(i.id);
    if (!e) added++;
    else if (contentKey(e) === contentKey(i)) unchanged++;
    else changed++;
  }
  return { added, changed, unchanged, removed: existing.filter((e) => !inc.has(e.id)).length };
}

export function planReplace(incoming: ImportBundle, existing: ImportBundle, licence?: { incoming: LicenceData; current: LicenceData }): ReplacePlan {
  const flights = diff(incoming.flights, existing.flights);
  const fstd = diff(incoming.fstd, existing.fstd);
  const experience = diff(incoming.experience, existing.experience);
  const changes = licence ? licenceChanges(licence.incoming, licence.current) : [];
  const destructive = [flights, fstd, experience].some((d) => d.changed > 0 || d.removed > 0) || changes.some((c) => c.from !== '');
  return { flights, fstd, experience, licence: changes, destructive };
}
