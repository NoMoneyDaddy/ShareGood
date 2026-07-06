"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type UploadResult = {
  id: string;
  variants: Record<string, { objectKey: string; width: number; height: number }>;
};

export function TestUploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError("");
    setResult(null);

    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/uploads", { method: "POST", body: form });
    const data = await res.json().catch(() => null);

    if (res.ok) {
      setResult(data);
    } else {
      setError(`${res.status}：${data?.error?.message ?? "上傳失敗"}`);
    }
    setUploading(false);
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm"
      />
      <Button type="submit" disabled={!file || uploading} className="w-full">
        {uploading ? "上傳中…" : "上傳測試"}
      </Button>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-1 rounded-md border border-line bg-card p-3 text-sm">
          <p className="font-semibold text-green-700">上傳成功</p>
          <p>id：{result.id}</p>
          {Object.entries(result.variants).map(([name, v]) => (
            <p key={name}>
              {name}：{v.width}×{v.height}（{v.objectKey}）
            </p>
          ))}
        </div>
      )}
    </form>
  );
}
