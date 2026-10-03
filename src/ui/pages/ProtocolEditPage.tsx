import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  useProtocol,
  parseProtocolMarkdown,
  parseProtocolMarkdownToForm,
  buildMarkdownFromForm,
  type ProtocolFormState,
  type StepFormState,
} from "@/hooks/useProtocol";
import { apiFetch } from "@/lib/api";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useSpaces } from "@/hooks/useSpaces";
import { DEFAULT_STEP, markdownSchema, SOURCE_ADAPTER_URI_RE } from "./protocol-edit/constants";
import { ProtocolEditImportSection } from "./protocol-edit/ProtocolEditImportSection";
import { ProtocolEditPreviewColumn } from "./protocol-edit/ProtocolEditPreviewColumn";
import { ProtocolEditSpaceSection } from "./protocol-edit/ProtocolEditSpaceSection";
import { ProtocolEditStepCard } from "./protocol-edit/ProtocolEditStepCard";

export function ProtocolEditPage() {
  const { t } = useTranslation();
  const { uri } = useParams<{ uri: string }>();
  const navigate = useNavigate();
  const decodedUri = uri ? decodeURIComponent(uri) : undefined;
  const isNew = !decodedUri;

  const { data, isLoading: loadingExisting } = useProtocol(decodedUri, !isNew);
  const [form, setForm] = useState<ProtocolFormState>({
    protocolLabel: "",
    triggersMarkdown: "",
    steps: [{ ...DEFAULT_STEP }],
    completionMarkdown: "",
  });
  const [uploadKey, setUploadKey] = useState(() => String(Date.now()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialSpaceIdRef = useRef<string>("");
  const [targetSpace, setTargetSpace] = useState("");
  const [moveSpace, setMoveSpace] = useState("");
  const [forkSourceUri, setForkSourceUri] = useState("");

  const { data: spacesData, isLoading: spacesLoading } = useSpaces(true, {});

  useEffect(() => {
    if (!isNew) return;
    setTargetSpace("");
    setForkSourceUri("");
  }, [isNew]);

  useEffect(() => {
    if (!isNew) return;
    const p = spacesData?.spaces?.find((s) => s.type === "personal");
    setTargetSpace((prev) => (prev === "" && p ? p.space_id : prev));
  }, [isNew, spacesData?.spaces]);

  useEffect(() => {
    if (isNew || !data) return;
    const sid = typeof data.space_id === "string" ? data.space_id.trim() : "";
    initialSpaceIdRef.current = sid;
    setMoveSpace(sid);
  }, [isNew, data]);

  useEffect(() => {
    if (data?.content) {
      try {
        setForm(parseProtocolMarkdownToForm(data.content));
        setUploadKey(String(Date.now()));
      } catch {
        setForm({
          protocolLabel: data.label || "Protocol",
          triggersMarkdown: "",
          steps: [{ ...DEFAULT_STEP }],
          completionMarkdown: "",
        });
      }
    }
  }, [data]);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      try {
        setForm(parseProtocolMarkdownToForm(text));
        setUploadKey(String(Date.now()));
        setValidationError(null);
        setError(null);
      } catch {
        setError("Could not parse the uploaded file. Use valid protocol markdown.");
      }
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  };

  const setFormField = <K extends keyof ProtocolFormState>(key: K, value: ProtocolFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setStep = (index: number, update: Partial<StepFormState> | ((s: StepFormState) => StepFormState)) => {
    setForm((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === index ? (typeof update === "function" ? update(s) : { ...s, ...update }) : s)),
    }));
  };

  const addStep = () => {
    setForm((prev) => ({ ...prev, steps: [...prev.steps, { ...DEFAULT_STEP, label: `Step ${prev.steps.length + 1}` }] }));
  };

  const removeStep = (index: number) => {
    setForm((prev) => ({ ...prev, steps: prev.steps.filter((_, i) => i !== index) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setValidationError(null);
    const markdown = buildMarkdownFromForm(form);
    const parsed = markdownSchema.safeParse(markdown);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid");
      return;
    }
    const fork = forkSourceUri.trim();
    if (fork && !SOURCE_ADAPTER_URI_RE.test(fork)) {
      setValidationError(t("protocolEdit.forkUriInvalid"));
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const spaceParam = targetSpace.trim() || "personal";
        const res = await apiFetch("/api/train", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: markdown,
            llm_model_id: "squadrules-ui",
            force_update: false,
            space: spaceParam,
            ...(fork ? { source_adapter_uri: fork } : {}),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { message?: string }).message ?? res.statusText);
        }
        const json = (await res.json()) as {
          items?: { uri?: string; adapter_uri?: string }[];
        };
        const adapterUri = json.items?.[0]?.adapter_uri;
        const layerUri = json.items?.[0]?.uri;
        if (adapterUri) navigate(`/protocols/${encodeURIComponent(adapterUri)}`);
        else if (layerUri) navigate(`/protocols/${encodeURIComponent(layerUri)}`);
        else navigate("/");
      } else {
        const initial = initialSpaceIdRef.current.trim();
        const nextSpace = moveSpace.trim();
        const tunePayload: Record<string, unknown> = {
          uris: [decodedUri!],
          content: [markdown],
        };
        if (nextSpace && nextSpace !== initial) {
          tunePayload.space = nextSpace;
        }
        const res = await apiFetch("/api/tune", {
          method: "POST",
          body: JSON.stringify(tunePayload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { message?: string }).message ?? res.statusText);
        }
        navigate(`/protocols/${encodeURIComponent(decodedUri!)}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const preview = (() => {
    try {
      return parseProtocolMarkdown(buildMarkdownFromForm(form));
    } catch {
      return { title: form.protocolLabel || "Protocol", steps: [], triggers: "", completion: "" };
    }
  })();

  if (!isNew && loadingExisting && !data) {
    return <p className="text-[var(--color-text-muted)]">{t("protocol.loading")}</p>;
  }

  const challengeTypeLabel: Record<StepFormState["type"], string> = {
    shell: t("protocolEdit.challengeShell"),
    mcp: t("protocolEdit.challengeMcp"),
    user_input: t("protocolEdit.challengeUserInput"),
    comment: t("protocolEdit.challengeComment"),
  };

  const skillFolderSlug =
    (form.protocolLabel.trim() || preview.title || "skill")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "skill";

  const labelInputClass =
    "min-h-[44px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2";

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-[var(--color-text-heading)]">
        {isNew ? t("protocolEdit.newTitle") : t("protocolEdit.editTitle")}
      </h1>
      <p className="mb-6 text-sm text-[var(--color-text-muted)]">{t("protocolEdit.hint")}</p>

      <ProtocolEditSpaceSection
        t={t}
        isNew={isNew}
        spaces={spacesData?.spaces}
        spacesLoading={spacesLoading}
        targetSpace={targetSpace}
        setTargetSpace={setTargetSpace}
        forkSourceUri={forkSourceUri}
        setForkSourceUri={setForkSourceUri}
        moveSpace={moveSpace}
        setMoveSpace={setMoveSpace}
      />

      <ProtocolEditImportSection
        t={t}
        fileInputRef={fileInputRef}
        onUpload={handleUpload}
        isNew={isNew}
        decodedUri={decodedUri}
      />

      <form onSubmit={handleSubmit} aria-label={t("protocolEdit.formLabel")}>
        <div className="mb-6 grid gap-6 xl:grid-cols-[1.45fr_1fr]">
          <div className="space-y-6">
            <div>
              <label htmlFor="protocol-label" className="mb-2 block font-medium text-[var(--color-text-heading)]">
                {t("protocolEdit.protocolLabel")}
              </label>
              <input
                id="protocol-label"
                type="text"
                value={form.protocolLabel}
                onChange={(e) => setFormField("protocolLabel", e.target.value)}
                className={labelInputClass}
              />
            </div>

            <RichTextEditor
              label={t("protocolEdit.triggersLabel")}
              hint={t("protocolEdit.triggersEditorHint")}
              value={form.triggersMarkdown}
              onChange={(v) => setFormField("triggersMarkdown", v)}
              contentKey={uploadKey}
            />

            {form.steps.map((step, index) => (
              <ProtocolEditStepCard
                key={index}
                t={t}
                step={step}
                index={index}
                stepsLength={form.steps.length}
                uploadKey={uploadKey}
                challengeTypeLabel={challengeTypeLabel}
                setStep={setStep}
                removeStep={removeStep}
              />
            ))}

            <button
              type="button"
              onClick={addStep}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
            >
              {t("protocolEdit.addStep")}
            </button>

            <RichTextEditor
              label={t("protocolEdit.completionLabel")}
              value={form.completionMarkdown}
              onChange={(v) => setFormField("completionMarkdown", v)}
              contentKey={uploadKey}
            />

            {validationError && (
              <p className="text-sm text-[var(--color-error)]" role="alert">
                {validationError}
              </p>
            )}
            {error && (
              <div className="rounded-[var(--radius-md)] bg-[var(--color-error-bg)] p-4 text-[var(--color-error)]" role="alert">
                {error}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2 font-medium text-white hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2 disabled:opacity-60"
              >
                {saving ? t("protocolEdit.saving") : t("protocolEdit.save")}
              </button>
              <Link
                to={isNew ? "/" : `/protocols/${encodeURIComponent(decodedUri!)}`}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 font-medium text-[var(--color-text)] no-underline hover:bg-[var(--color-surface-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2"
              >
                {t("protocolEdit.cancel")}
              </Link>
            </div>
          </div>

          <ProtocolEditPreviewColumn
            t={t}
            preview={preview}
            skillFolderSlug={skillFolderSlug}
            isNew={isNew}
            decodedUri={decodedUri}
          />
        </div>
      </form>
    </div>
  );
}
