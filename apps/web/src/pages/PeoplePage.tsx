import { useState } from "react";
import type { DeviceProfile, Person, Preset } from "@lpd/shared";
import { api } from "../lib/api";
import { invalidate, usePeople, usePresets, useProfiles } from "../lib/queries";
import { NameDialog, NumberField, TextField, toast } from "../lib/ui";
import { TopBar } from "../panels/TopBar";

export function PeoplePage() {
  const people = usePeople();
  const profiles = useProfiles();
  const presets = usePresets();
  return (
    <div className="app">
      <TopBar />
      <main className="page">
        <div className="stack">
          <PeopleCard people={people.data ?? []} profiles={profiles.data ?? []} />
          <PresetsCard presets={presets.data ?? []} />
          <ProfilesCard profiles={profiles.data ?? []} />
        </div>
      </main>
    </div>
  );
}

const blankPerson: Omit<Person, "id"> = { name: "", handle: "", devices: [], needsEthernet: true, notes: "" };

function PeopleCard({ people, profiles }: { people: Person[]; profiles: DeviceProfile[] }) {
  const [draft, setDraft] = useState(blankPerson);
  const run = (fn: () => Promise<unknown>) =>
    fn().then(() => invalidate("people")).catch((e) => toast(e.message));
  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name ?? id;

  return (
    <section className="card stack" aria-labelledby="people-h">
      <h2 id="people-h">People</h2>
      <p className="muted">Everyone who might come. Their usual gear carries over to every event.</p>
      {people.length === 0 ? (
        <div className="empty">No one yet. Add your regulars below.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Handle</th>
              <th>Devices</th>
              <th>Ethernet</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <PersonRow key={p.id} person={p} profiles={profiles} profileName={profileName} run={run} />
            ))}
          </tbody>
        </table>
      )}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.name.trim()) return;
          run(() => api.createPerson({ ...draft, name: draft.name.trim() })).then(() => setDraft(blankPerson));
        }}
      >
        <h3>Add a person</h3>
        <div className="row">
          <div style={{ flex: 1, minWidth: 160 }}>
            <TextField label="Name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <TextField label="Handle" value={draft.handle} onChange={(handle) => setDraft({ ...draft, handle })} />
          </div>
          <div style={{ flex: 2, minWidth: 220 }}>
            <DevicePicker
              profiles={profiles}
              value={draft.devices.map((d) => d.profileId)}
              onChange={(ids) => setDraft({ ...draft, devices: ids.map((profileId) => ({ profileId })) })}
            />
          </div>
        </div>
        <button className="btn primary" style={{ justifySelf: "start" }} disabled={!draft.name.trim()}>
          Add person
        </button>
      </form>
    </section>
  );
}

function PersonRow(props: {
  person: Person;
  profiles: DeviceProfile[];
  profileName: (id: string) => string;
  run: (fn: () => Promise<unknown>) => Promise<unknown>;
}) {
  const { person: p } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Omit<Person, "id">>(p);
  if (editing) {
    return (
      <tr>
        <td colSpan={5}>
          <div className="stack">
            <div className="row">
              <TextField label="Name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
              <TextField label="Handle" value={draft.handle} onChange={(handle) => setDraft({ ...draft, handle })} />
              <label className="field check">
                <input
                  type="checkbox"
                  checked={draft.needsEthernet}
                  onChange={(e) => setDraft({ ...draft, needsEthernet: e.target.checked })}
                />
                Needs ethernet
              </label>
            </div>
            <DevicePicker
              profiles={props.profiles}
              value={draft.devices.map((d) => d.profileId)}
              onChange={(ids) => setDraft({ ...draft, devices: ids.map((profileId) => ({ profileId })) })}
            />
            <TextField label="Notes" value={draft.notes} onChange={(notes) => setDraft({ ...draft, notes })} />
            <div className="row">
              <button
                className="btn primary small"
                onClick={() => props.run(() => api.savePerson(p.id, draft)).then(() => setEditing(false))}
              >
                Save
              </button>
              <button className="btn small" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td>{p.name}</td>
      <td className="muted">{p.handle}</td>
      <td className="muted">{p.devices.map((d) => props.profileName(d.profileId)).join(", ") || "None"}</td>
      <td>{p.needsEthernet ? "Yes" : "No"}</td>
      <td className="num">
        <button className="btn small" onClick={() => { setDraft(p); setEditing(true); }}>
          Edit
        </button>{" "}
        <button
          className="btn small danger"
          onClick={() => confirm(`Remove ${p.name}?`) && props.run(() => api.deletePerson(p.id))}
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

export function DevicePicker(props: {
  profiles: DeviceProfile[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const name = (id: string) => props.profiles.find((p) => p.id === id)?.name ?? id;
  return (
    <div className="field">
      Devices
      <div className="row">
        {props.value.map((id, i) => (
          <span key={`${id}-${i}`} className="badge info">
            {name(id)}
            <button
              type="button"
              className="btn ghost small"
              aria-label={`Remove ${name(id)}`}
              onClick={() => props.onChange(props.value.filter((_, j) => j !== i))}
              style={{ padding: 0 }}
            >
              ×
            </button>
          </span>
        ))}
        <select
          aria-label="Add device"
          value=""
          style={{ width: "auto" }}
          onChange={(e) => e.target.value && props.onChange([...props.value, e.target.value])}
        >
          <option value="">Add device…</option>
          {props.profiles
            .filter((p) => p.kind !== "switch" && p.kind !== "router")
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.typicalW} W)
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}

function ProfilesCard({ profiles }: { profiles: DeviceProfile[] }) {
  const [draft, setDraft] = useState<Omit<DeviceProfile, "id">>({
    name: "",
    kind: "pc",
    typicalW: 200,
    peakW: 350,
    ports: 0,
  });
  const run = (fn: () => Promise<unknown>) =>
    fn().then(() => invalidate("profiles")).catch((e) => toast(e.message));
  return (
    <section className="card stack" aria-labelledby="profiles-h">
      <h2 id="profiles-h">Device profiles</h2>
      <p className="muted">
        Use measured wall draw, not the power supply label. Typical is what it pulls in a normal session, peak is the
        worst spike.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th className="num">Typical</th>
            <th className="num">Peak</th>
            <th className="num">Ports</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td className="muted">{p.kind}</td>
              <td className="num">{p.typicalW} W</td>
              <td className="num">{p.peakW} W</td>
              <td className="num">{p.ports || ""}</td>
              <td className="num">
                <button
                  className="btn small danger"
                  onClick={() => confirm(`Delete profile "${p.name}"?`) && run(() => api.deleteProfile(p.id))}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="row"
        style={{ alignItems: "end" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.name.trim()) run(() => api.createProfile({ ...draft, name: draft.name.trim() }));
        }}
      >
        <div style={{ flex: 2, minWidth: 160 }}>
          <TextField label="New profile name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
        </div>
        <label className="field">
          Kind
          <select
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as DeviceProfile["kind"] })}
          >
            {["pc", "laptop", "monitor", "console", "switch", "router", "server", "display", "other"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <div style={{ width: 90 }}>
          <NumberField label="Typical W" step={5} value={draft.typicalW} onChange={(typicalW) => setDraft({ ...draft, typicalW })} />
        </div>
        <div style={{ width: 90 }}>
          <NumberField label="Peak W" step={5} value={draft.peakW} onChange={(peakW) => setDraft({ ...draft, peakW })} />
        </div>
        <div style={{ width: 80 }}>
          <NumberField label="Ports" step={1} min={0} value={draft.ports} onChange={(ports) => setDraft({ ...draft, ports })} />
        </div>
        <button className="btn primary" disabled={!draft.name.trim()}>
          Add profile
        </button>
      </form>
    </section>
  );
}

function PresetsCard({ presets }: { presets: Preset[] }) {
  const [renaming, setRenaming] = useState<Preset | null>(null);
  const run = (fn: () => Promise<unknown>) =>
    fn().then(() => invalidate("presets")).catch((e) => toast(e.message));
  const describe = (p: Preset) =>
    p.kind === "table"
      ? `${p.spec.shape === "round" ? `${p.spec.width} ft round` : `${p.spec.width} × ${p.spec.depth} ft`}, ${p.spec.seats} ${p.spec.shape === "round" ? "seats" : "seats per side"}${p.spec.seatSides !== "both" && p.spec.shape === "rect" ? ", one side" : ""}`
      : `${p.spec.sockets} outlets, ${p.spec.amps}A`;
  return (
    <section className="card stack" aria-labelledby="presets-h">
      <h2 id="presets-h">Your tables and power strips</h2>
      <p className="muted">
        Save a table or strip from the event editor to reuse it by name. Custom switches are listed under Device profiles below.
      </p>
      {presets.length === 0 ? (
        <div className="empty">Nothing saved yet. Select a table or power strip in an event and choose Save as a custom table or strip.</div>
      ) : (
        <ul className="list">
          {presets.map((p) => (
            <li key={p.id}>
              <div className="grow"><strong>{p.name}</strong><div className="muted">{p.kind === "table" ? "Table" : "Power strip"}: {describe(p)}</div></div>
              <button className="btn small" onClick={() => setRenaming(p)}>Rename</button>
              <button className="btn small danger" onClick={() => confirm(`Delete "${p.name}"? Items already placed in events are not affected.`) && run(() => api.deletePreset(p.id))}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {renaming && (
        <NameDialog
          title="Rename"
          initial={renaming.name}
          action="Save name"
          onClose={() => setRenaming(null)}
          onSubmit={async (name) => {
            await run(() => api.savePreset(renaming.id, { ...renaming, name } as never));
          }}
        />
      )}
    </section>
  );
}
