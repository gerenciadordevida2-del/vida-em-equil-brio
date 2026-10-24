import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";
import { Download, Upload, Trash2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Page, Card } from "@/components/AppShell";
import { exportBackup, importBackup, clearAll } from "@/lib/store";

export const Route = createFileRoute("/ajustes")({
  head: () => ({
    meta: [
      { title: "Ajustes e backup — Gerenciador de Vida" },
      { name: "description", content: "Faça backup e restaure seus dados do Gerenciador de Vida." },
      { property: "og:title", content: "Ajustes — Gerenciador de Vida" },
      { property: "og:description", content: "Backup e restauração dos seus dados." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Ajustes,
});

function Ajustes() {
  const fileRef = useRef<HTMLInputElement>(null);
  const btn = "flex h-12 w-full items-center justify-center gap-2 rounded-xl font-semibold";
  return (
    <Page title="Ajustes" subtitle="Seus dados ficam só neste aparelho">
      <Card className="mb-4 space-y-3">
        <h2 className="font-semibold">Backup</h2>
        <p className="text-sm text-muted-foreground">
          Salve um arquivo com todos os seus dados. Guarde no Google Drive ou envie para você mesmo.
        </p>
        <button
          onClick={() => {
            exportBackup();
            toast.success("Backup gerado!");
          }}
          className={`${btn} bg-primary text-primary-foreground`}
        >
          <Download className="h-5 w-5" /> Fazer backup
        </button>
        <button onClick={() => fileRef.current?.click()} className={`${btn} border bg-secondary`}>
          <Upload className="h-5 w-5" /> Restaurar backup
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f || !confirm("Restaurar vai substituir os dados atuais. Continuar?")) return;
            try {
              await importBackup(f);
              toast.success("Dados restaurados!");
            } catch {
              toast.error("Arquivo de backup inválido.");
            }
          }}
        />
      </Card>
      <Card className="mb-4 space-y-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Smartphone className="h-4 w-4 text-primary" /> Instalar no celular
        </h2>
        <p className="text-sm text-muted-foreground">
          No Chrome do Android, abra o menu (⋮) e toque em “Adicionar à tela inicial” ou “Instalar
          app”.
        </p>
      </Card>
      <Card>
        <button
          onClick={() => {
            if (confirm("Apagar TODOS os dados? Isso não pode ser desfeito.")) {
              clearAll();
              toast("Dados apagados.");
            }
          }}
          className={`${btn} text-destructive`}
        >
          <Trash2 className="h-5 w-5" /> Apagar todos os dados
        </button>
      </Card>
    </Page>
  );
}
