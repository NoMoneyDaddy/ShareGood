"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OnboardingForm({
  cities,
  defaultNickname,
  defaultCityId,
}: {
  cities: Array<{ id: string; name: string }>;
  defaultNickname: string;
  defaultCityId: string;
}) {
  const router = useRouter();
  const [nickname, setNickname] = useState(defaultNickname);
  const [cityId, setCityId] = useState(defaultCityId);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname, cityId: cityId || null }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "儲存失敗，請再試一次");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-6">
      <div className="space-y-2">
        <Label htmlFor="nickname">暱稱（2–20 字）</Label>
        <Input
          id="nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          minLength={2}
          maxLength={20}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="city">所在縣市</Label>
        <select
          id="city"
          value={cityId}
          onChange={(e) => setCityId(e.target.value)}
          className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm"
        >
          <option value="">先不設定</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "儲存中…" : "完成設定"}
      </Button>
    </form>
  );
}
