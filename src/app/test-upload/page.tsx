import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { TestUploadForm } from "./test-upload-form";

export const metadata = { title: "上傳管線測試" };

// M0 驗收用暫時頁面：驗證 MinIO 圖片管線（磁位元組檢查／壓縮／縮圖）跑得動。
// 不掛在任何導覽列或首頁，M1 做正式上架表單時直接整批移除這個目錄。
export default async function TestUploadPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-bold">上傳管線測試</h1>
      <p className="mt-2 text-muted-foreground">
        這是 M0 驗收用的暫時頁面，不是正式上架功能。選一張圖片上傳，確認 MinIO
        管線正常運作即可，跟真正的「上架」流程無關。
      </p>
      <TestUploadForm />
    </main>
  );
}
