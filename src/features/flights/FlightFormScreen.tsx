import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../AppContext';
import type { Airport, Flight, Role } from '../../domain/types';
import { CLASS_RATINGS, CLASS_RATING_LABELS, ENGINE_CLASSES, ROLES } from '../../domain/types';
import {
  type FlightFormState,
  applyAircraft,
  applyAuto,
  editableSnapshot,
  setLandings,
  setNightMinutes,
  setTakeoffs,
  resetToComputed,
  emptyForm,
  formFromFlight,
  formToFlightInput,
  hasErrors,
  resetTotal,
  setTotal,
  updateForm,
  validateForm,
} from '../../domain/flightForm';
import { setRoleMinutes, toggleRole } from '../../domain/roles';
import { addDays, dateOfTimestamp, daysBetween, effectiveArrDate, formatHHMM, resolveBlockTimes } from '../../domain/time';
import { computeNight } from '../../domain/night';
import {
  defaultsFromHistory,
  findAircraftByRegistration,
  normalizeRegistration,
  personKey,
  recentPlaces,
  recentAircraft,
  recentPersons,
} from '../../domain/suggestions';
import { Dialog, DurationField, Field, Stepper, SuggestionChips, keepFocus } from '../../ui/components';
import { MoonIcon } from '../../ui/Icons';

export function FlightFormScreen({ flight }: { flight?: Flight }) {
  const { data, writer, go, reload, airports } = useApp();
  const editing = flight !== undefined;

  const initial = useMemo<FlightFormState>(() => {
    if (flight) {
      const pic = data.persons.find((p) => p.id === flight.picNameId)?.name ?? 'SELF';
      return formFromFlight(flight, pic);
    }
    const d = defaultsFromHistory(data.flights, data.aircraft, data.persons);
    let s = emptyForm({ today: dateOfTimestamp(Date.now()), picName: d.picName, registration: d.registration });
    s = { ...s, depPlace: d.depPlace };
    const known = findAircraftByRegistration(data.aircraft, d.registration);
    return known ? applyAircraft(s, known) : s;
    // Computed once per screen mount: later data reloads must not clobber what the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight?.id]);

  const [form, setForm] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = editableSnapshot(form) !== editableSnapshot(initial);
  useEffect(() => {
    if (!dirty) return;
    const on = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, [dirty]);

  // --- Airports + night time (phase 2) ---
  const [airportInfo, setAirportInfo] = useState<{ count: number; dep?: Airport; arr?: Airport } | null>(null);
  const firstCalc = useRef(true);
  const calcKey = `${form.date}|${form.depClock}|${form.arrClock}|${form.arrDate}|${form.depPlace.trim()}|${form.arrPlace.trim()}`;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const depCode = form.depPlace.trim().toUpperCase();
      const arrCode = form.arrPlace.trim().toUpperCase();
      const [count, found] = await Promise.all([airports.count(), airports.getMany([depCode, arrCode])]);
      if (cancelled) return;
      const dep = found.get(depCode);
      const arr = found.get(arrCode);
      const t = resolveBlockTimes(form.date, form.depClock, form.arrClock, form.arrDate);
      const auto = dep && arr && t && t.arr > t.dep
        ? computeNight({ depTime: t.dep, arrTime: t.arr, from: dep, to: arr })
        : null;
      setAirportInfo({ count, dep, arr });
      // Opening an existing flight adopts its stored values; every later change follows the calculation.
      const mode = firstCalc.current && editing ? 'adopt' : 'follow';
      firstCalc.current = false;
      setForm((s) => applyAuto(s, auto, mode));
    })();
    return () => { cancelled = true; };
    // The inputs that matter are captured by calcKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcKey, airports, editing]);

  const issues = useMemo(() => validateForm(form), [form]);
  const err = (f: string) => (submitted ? issues.find((i) => i.field === f && i.severity === 'error')?.message : undefined);
  const warn = (f: string) => issues.find((i) => i.field === f && i.severity === 'warning')?.message;

  const aircraftOptions = useMemo(() => recentAircraft(data.flights, data.aircraft), [data]);
  const personOptions = useMemo(() => recentPersons(data.flights, data.persons), [data]);
  const placeOptions = useMemo(() => recentPlaces(data.flights, 6), [data.flights]);

  if (!writer) return <div className="empty">This device is not the master logbook, so editing is disabled.</div>;

  const patch = (p: Partial<FlightFormState>) => setForm((s) => updateForm(s, p));

  // The landing date follows the take-off date and times (next day if the arrival clock is earlier) until it is set by hand.
  const autoLandingDate = effectiveArrDate(form.date, form.depClock, form.arrClock);
  const landingDate = effectiveArrDate(form.date, form.depClock, form.arrClock, form.arrDate) ?? form.date;
  const landingHint = !form.arrDate
    ? (autoLandingDate && autoLandingDate !== form.date ? 'Next day: the flight crossed midnight UTC.' : 'Same day. Change it if you landed on another date.')
    : (landingDate === form.date ? 'Same day.' : landingDate > form.date ? 'Set by hand.' : 'Before take-off: check this date.');
  const onDate = (value: string) => setForm((st) => {
    // Keep a hand-set landing date the same number of days after take-off.
    const shifted = st.arrDate && value ? addDays(value, daysBetween(st.date, st.arrDate)) : st.arrDate;
    return updateForm(st, { date: value, arrDate: shifted });
  });
  const onLandingDate = (value: string) => setForm((st) => {
    // Back to automatic when it matches what the automatic rule gives.
    const auto = effectiveArrDate(st.date, st.depClock, st.arrClock);
    return updateForm(st, { arrDate: !value || value === auto ? '' : value });
  });
  const onRegistration = (v: string) => {
    const upper = v.toUpperCase();
    const known = findAircraftByRegistration(data.aircraft, upper);
    setForm((s) => (known ? applyAircraft(s, known) : updateForm(s, { registration: upper })));
  };
  const onRole = (r: Role) => setForm((s) => updateForm(s, { roles: toggleRole(s.roles, r, s.totalMin) }));

  const cancel = () => (dirty ? setConfirmDiscard(true) : leave());
  const leave = () => go(editing ? { name: 'flight', id: flight.id } : { name: 'list' }, { replace: true });

  const save = async () => {
    setSubmitted(true);
    if (hasErrors(issues)) {
      requestAnimationFrame(() => document.querySelector('.field.invalid')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const input = formToFlightInput(form, { attachmentIds: flight?.attachmentIds, previousOverrides: flight?.overrides });
      const saved = await writer.saveFlight(input, flight?.id);
      await reload();
      go({ name: 'flight', id: saved.id }, { replace: true });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!flight) return;
    await writer.deleteFlight(flight.id);
    await reload();
    go({ name: 'list' }, { replace: true });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <p className="hint" style={{ margin: '0 4px 12px' }}>All times are UTC (off-blocks / on-blocks).</p>

      <div className="card">
        <Field label="Take-off date (UTC)" error={err('times')} warning={warn('times')} htmlFor="f-date">
          <input id="f-date" className="input" type="date" value={form.date} onChange={(e) => onDate(e.target.value)} />
        </Field>
        <div className="grid2">
          <Field label="Off-blocks (UTC)" htmlFor="f-dep">
            <input id="f-dep" className="input" type="time" value={form.depClock} onChange={(e) => patch({ depClock: e.target.value })} />
          </Field>
          <Field label="On-blocks (UTC)" htmlFor="f-arr">
            <input id="f-arr" className="input" type="time" value={form.arrClock} onChange={(e) => patch({ arrClock: e.target.value })} />
          </Field>
        </div>
        <Field label="Landing date (UTC)" hint={landingHint} htmlFor="f-arrdate">
          <input id="f-arrdate" className="input" type="date" value={landingDate} onChange={(e) => onLandingDate(e.target.value)} />
        </Field>
        <div className="total-box">
          <div>
            <div className="hint">Total flight time {form.totalManual ? '(manual)' : '(block time)'}</div>
            <div className="big">{formatHHMM(form.totalMin)}</div>
          </div>
          <div>
            <DurationField label="Total" value={form.totalMin} onChange={(m) => setForm((s) => setTotal(s, m))} />
            {form.totalManual && (
              <button type="button" className="btn text" onClick={() => setForm((s) => resetTotal(s))}>Reset to block time</button>
            )}
          </div>
        </div>
        {err('totalMin') && <div className="msg error" role="alert">{err('totalMin')}</div>}
      </div>

      <div className="card">
        <div className="grid2">
          <Field label="From (ICAO)" error={err('depPlace')} warning={warn('depPlace')} hint={airportInfo?.dep?.name} htmlFor="f-from">
            <input id="f-from" className="input" autoCapitalize="characters" autoComplete="off" value={form.depPlace}
              onChange={(e) => patch({ depPlace: e.target.value.toUpperCase() })} />
            <SuggestionChips label="Recent airports for From" items={placeOptions.slice(0, 4).map((x) => ({ key: x, text: x }))}
              selected={form.depPlace.trim().toUpperCase()} onPick={(k) => patch({ depPlace: k })} />
          </Field>
          <Field label="To (ICAO)" error={err('arrPlace')} warning={warn('arrPlace')} hint={airportInfo?.arr?.name} htmlFor="f-to">
            <input id="f-to" className="input" autoCapitalize="characters" autoComplete="off" value={form.arrPlace}
              onChange={(e) => patch({ arrPlace: e.target.value.toUpperCase() })} />
            <SuggestionChips label="Recent airports for To" items={placeOptions.slice(0, 4).map((x) => ({ key: x, text: x }))}
              selected={form.arrPlace.trim().toUpperCase()} onPick={(k) => patch({ arrPlace: k })} />
          </Field>
        </div>
      </div>

      <div className="card">
        <SuggestionChips label="Known aircraft" items={aircraftOptions.slice(0, 8).map((a) => ({ key: a.registration, text: `${a.registration} · ${a.make} ${a.model}` }))}
          selected={normalizeRegistration(form.registration)}
          onPick={(k) => { const a = aircraftOptions.find((x) => x.registration === k); if (a) setForm((st) => applyAircraft(st, a)); }} />
        <Field label="Registration" error={err('registration')} htmlFor="f-reg">
          <input id="f-reg" className="input" autoCapitalize="characters" autoComplete="off" value={form.registration}
            onChange={(e) => onRegistration(e.target.value)} />
        </Field>
        <div className="grid2">
          <Field label="Make" error={err('make')} htmlFor="f-make">
            <input id="f-make" className="input" value={form.make} onChange={(e) => patch({ make: e.target.value })} />
          </Field>
          <Field label="Model" error={err('model')} htmlFor="f-model">
            <input id="f-model" className="input" value={form.model} onChange={(e) => patch({ model: e.target.value })} />
          </Field>
        </div>
        <Field label="Variant" htmlFor="f-variant">
          <input id="f-variant" className="input" value={form.variant} onChange={(e) => patch({ variant: e.target.value })} />
        </Field>
        <Field label="Class" htmlFor="f-class">
          <select id="f-class" className="input" value={form.aircraftClass}
            onChange={(e) => patch({ aircraftClass: e.target.value as FlightFormState['aircraftClass'] })}>
            {CLASS_RATINGS.map((c) => <option key={c} value={c}>{CLASS_RATING_LABELS[c]}</option>)}
          </select>
        </Field>
        <div className="field">
          <span className="label">Pilot time category</span>
          <div className="chips" role="group" aria-label="Pilot time category">
            {ENGINE_CLASSES.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={form.engineClass === c} onMouseDown={keepFocus} onClick={() => patch({ engineClass: c })}>{c}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <Field label="Name of PIC" error={err('picName')} htmlFor="f-pic">
          <input id="f-pic" className="input" autoComplete="off" value={form.picName} onChange={(e) => patch({ picName: e.target.value })} />
          <SuggestionChips label="Recent pilots in command" items={personOptions.slice(0, 6).map((p) => ({ key: p.id, text: p.name }))}
            selected={personOptions.find((p) => personKey(p.name) === personKey(form.picName))?.id ?? null}
            onPick={(k) => { const p = personOptions.find((x) => x.id === k); if (p) patch({ picName: p.name }); }} />
        </Field>
        <div className="field">
          <span className="label">My function (tap to select; time defaults to total)</span>
          {ROLES.map((r) => {
            const e = form.roles[r];
            return (
              <div className="role-row" key={r}>
                <button type="button" className={`chip role-${r}`} aria-pressed={e.on} onMouseDown={keepFocus} onClick={() => onRole(r)}>{r}</button>
                {e.on && (
                  <DurationField label={`${r} time`} value={e.min} onChange={(m) => setForm((s) => updateForm(s, { roles: setRoleMinutes(s.roles, r, m) }))} />
                )}
                {err(`role-${r}`) && <span className="msg error">{err(`role-${r}`)}</span>}
              </div>
            );
          })}
          {warn('roles') && <div className="msg warning">{warn('roles')}</div>}
        </div>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={form.isPicus} onMouseDown={keepFocus} onClick={() => patch({ isPicus: !form.isPicus })}>PICUS</button>
          <button type="button" className="chip" aria-pressed={form.isSpic} onMouseDown={keepFocus} onClick={() => patch({ isSpic: !form.isSpic })}>SPIC</button>
        </div>
        {warn('isPicus') && form.isPicus && <div className="msg warning">{warn('isPicus')}</div>}
      </div>

      <div className="card">
        <div className="grid2">
          <Stepper label="Take-offs day" value={form.takeoffsDay} onChange={(n) => setForm((s) => setTakeoffs(s, { takeoffsDay: n }))} />
          <Stepper label="Take-offs night" value={form.takeoffsNight} onChange={(n) => setForm((s) => setTakeoffs(s, { takeoffsNight: n }))} />
        </div>
        {form.takeoffsManual && form.autoNight && <OverrideNote text={`Computed: ${form.autoNight.takeoffNight ? 'night' : 'day'} take-off`} onUse={() => setForm((s) => resetToComputed(s, 'takeoffs'))} />}
        <div className="grid2">
          <Stepper label="Landings day" value={form.landingsDay} onChange={(n) => setForm((s) => setLandings(s, { landingsDay: n }))} />
          <Stepper label="Landings night" value={form.landingsNight} onChange={(n) => setForm((s) => setLandings(s, { landingsNight: n }))} />
        </div>
        {form.landingsManual && form.autoNight && <OverrideNote text={`Computed: ${form.autoNight.landingNight ? 'night' : 'day'} landing`} onUse={() => setForm((s) => resetToComputed(s, 'landings'))} />}
        <Field label="Night time" error={err('nightMin')}>
          <DurationField label="Night time" value={form.nightMin} onChange={(m) => setForm((s) => setNightMinutes(s, m))} />
        </Field>
        {form.autoNight ? (
          form.nightManual ? (
            <OverrideNote text={`Computed from sun position: ${formatHHMM(form.autoNight.nightMin)}`} onUse={() => setForm((s) => resetToComputed(s, 'night'))} />
          ) : (
            <p className="auto-note"><MoonIcon /> Computed from the sun's position along the route (sun more than 6° below the horizon). Edit to override.</p>
          )
        ) : (
          <p className="hint">{nightStatus(form, airportInfo)}</p>
        )}
        <Field label="IFR time" error={err('ifrMin')}>
          <DurationField label="IFR time" value={form.ifrMin} onChange={(m) => patch({ ifrMin: m })} />
        </Field>
      </div>

      <div className="card">
        <Field label="Remarks" htmlFor="f-remarks">
          <textarea id="f-remarks" className="input" value={form.remarks} onChange={(e) => patch({ remarks: e.target.value })} />
        </Field>
      </div>

      {editing && (
        <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>Delete flight…</button>
      )}
      {saveError && <div className="msg error" role="alert" style={{ marginTop: 12 }}>Could not save: {saveError}</div>}
      {submitted && hasErrors(issues) && <div className="msg error" role="alert" style={{ marginTop: 12 }}>Fix the highlighted fields to save.</div>}

      <div className="actionbar">
        <button type="button" className="btn text" onClick={cancel}>Cancel</button>
        <button type="submit" className="btn filled" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save flight'}</button>
      </div>

      <Dialog open={confirmDiscard} title="Discard changes?" onClose={() => setConfirmDiscard(false)}
        actions={<>
          <button type="button" className="btn text" onClick={() => setConfirmDiscard(false)}>Keep editing</button>
          <button type="button" className="btn tonal" onClick={() => { setConfirmDiscard(false); leave(); }}>Discard</button>
        </>}>
        Your unsaved changes to this flight will be lost.
      </Dialog>
      <Dialog open={confirmDelete} title="Delete this flight?" onClose={() => setConfirmDelete(false)}
        actions={<>
          <button type="button" className="btn text" onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button type="button" className="btn danger" onClick={() => void remove()}>Delete</button>
        </>}>
        This permanently removes the flight and its attachments from this device. It cannot be undone, except by restoring a backup.
      </Dialog>
    </form>
  );
}

function OverrideNote({ text, onUse }: { text: string; onUse: () => void }) {
  return (
    <div className="override-note">
      <span className="chip flag">Overridden</span>
      <span className="hint">{text}</span>
      <button type="button" className="btn text" onClick={onUse}>Use computed</button>
    </div>
  );
}

/** Why night time could not be computed, in plain words. */
function nightStatus(form: FlightFormState, info: { count: number; dep?: Airport; arr?: Airport } | null): string {
  const t = resolveBlockTimes(form.date, form.depClock, form.arrClock, form.arrDate);
  if (!form.depPlace.trim() || !form.arrPlace.trim() || !t) return 'Enter the airports and times to calculate night time and day/night take-offs and landings.';
  if (info && info.count === 0) return 'No airports database yet. Import it in Settings to calculate night time automatically; until then enter it by hand.';
  if (info && !info.dep) return `${form.depPlace.trim().toUpperCase()} is not in the airports database. Enter night time and day/night counts by hand.`;
  if (info && !info.arr) return `${form.arrPlace.trim().toUpperCase()} is not in the airports database. Enter night time and day/night counts by hand.`;
  return 'Night time is entered by hand.';
}
