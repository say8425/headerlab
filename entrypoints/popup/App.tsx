import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { createProfile } from '@/lib/model/defaults';
import { useAppState } from '@/lib/storage/useAppState';
import type { HeaderRule, Profile } from '@/lib/model/types';

export default function App() {
  const { state, update } = useAppState();
  if (!state) return <div className="w-[560px] p-4 text-sm">Loading…</div>;

  // `noUncheckedIndexedAccess` is on, so this is `Profile | undefined`.
  const profile = state.profiles[0];

  const addProfile = () =>
    update((s) => ({ ...s, profiles: [createProfile('Local', 0)] }));

  // Typed against `Profile`, not `typeof profile` — the latter would carry the
  // `undefined` and make `map` produce `(Profile | undefined)[]`, which does not
  // assign back to `profiles`. The `if (!profile)` guard below is too late to help:
  // it narrows the render branch, not this closure.
  const patchProfile = (fn: (p: Profile) => Profile) =>
    update((s) => ({ ...s, profiles: s.profiles.map((p, i) => (i === 0 ? fn(p) : p)) }));

  const addHeader = () =>
    patchProfile((p) => ({
      ...p,
      headers: [
        ...p.headers,
        {
          id: crypto.randomUUID(),
          enabled: true,
          target: 'request',
          operation: 'set',
          name: '',
          value: '',
        } satisfies HeaderRule,
      ],
    }));

  const patchHeader = (id: string, patch: Partial<HeaderRule>) =>
    patchProfile((p) => ({
      ...p,
      headers: p.headers.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    }));

  if (!profile) {
    return (
      <div className="w-[560px] space-y-3 p-4">
        <p className="text-sm text-muted-foreground">No profile yet.</p>
        <Button onClick={addProfile}>Create profile</Button>
      </div>
    );
  }

  return (
    <div className="w-[560px] space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Switch
          checked={profile.enabled}
          onCheckedChange={(enabled) => patchProfile((p) => ({ ...p, enabled }))}
        />
        <span className="text-sm font-medium">{profile.name}</span>
      </div>

      <Input
        placeholder="Domain, e.g. api.example.com"
        value={profile.filter.domains.join(', ')}
        onChange={(e) =>
          patchProfile((p) => ({
            ...p,
            filter: {
              ...p.filter,
              domains: e.target.value.split(',').map((d) => d.trim()).filter(Boolean),
            },
          }))
        }
      />

      {profile.headers.map((header) => (
        <div key={header.id} className="flex items-center gap-2">
          <Switch
            checked={header.enabled}
            onCheckedChange={(enabled) => patchHeader(header.id, { enabled })}
          />
          <Input
            className="flex-1"
            placeholder="Header name"
            value={header.name}
            onChange={(e) => patchHeader(header.id, { name: e.target.value })}
          />
          <Input
            className="flex-1 font-mono"
            placeholder="Value"
            value={header.value}
            onChange={(e) => patchHeader(header.id, { value: e.target.value })}
          />
        </div>
      ))}

      <Button variant="secondary" onClick={addHeader}>
        Add header
      </Button>
    </div>
  );
}
