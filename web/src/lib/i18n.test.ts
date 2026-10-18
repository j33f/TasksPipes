import { afterEach, describe, expect, it } from "vitest";
import { LOCALES, intlLocale, prefs, t, tn } from "./i18n.svelte";

afterEach(() => prefs.set({ locale: null, theme: null }));

describe("t", () => {
  it("shows the English source text, or its French version", () => {
    prefs.set({ locale: "en" });
    expect(t("New task")).toBe("New task");
    prefs.set({ locale: "fr" });
    expect(t("New task")).toBe("Nouvelle tâche");
  });

  it("fills placeholders and keeps unknown text", () => {
    prefs.set({ locale: "fr" });
    expect(t("Sent by {name}", { name: "Bob" })).toBe("Envoyée par Bob");
    expect(t("Not in the dictionary {x}", {})).toBe("Not in the dictionary {x}");
  });
});

describe("tn", () => {
  it("follows each language's plural rules", () => {
    prefs.set({ locale: "en" });
    expect(tn(0, "{n} task", "{n} tasks")).toBe("0 tasks");
    expect(tn(1, "{n} task", "{n} tasks")).toBe("1 task");
    prefs.set({ locale: "fr" });
    expect(tn(0, "{n} task", "{n} tasks")).toBe("0 tâche"); // French counts 0 as singular
    expect(tn(2, "{n} task", "{n} tasks")).toBe("2 tâches");
  });
});

describe("prefs", () => {
  it("remembers the choices in the browser and follows it otherwise", () => {
    prefs.set({ locale: "fr", theme: "dark" });
    expect(localStorage.getItem("tp:locale")).toBe("fr");
    expect(localStorage.getItem("tp:theme")).toBe("dark");
    expect(intlLocale()).toBe("fr-FR");
    prefs.set({ locale: null, theme: null });
    expect(localStorage.getItem("tp:locale")).toBeNull();
    expect(prefs.lang).toBe(navigator.language.startsWith("fr") ? "fr" : "en");
  });

  it("ignores values it does not know", () => {
    prefs.set({ locale: "xx", theme: "blue" as never });
    expect(prefs.locale).toBeNull();
    expect(prefs.theme).toBeNull();
  });
});

describe("languages", () => {
  it("are the files of locales/, by their own name, English first", () => {
    expect(LOCALES[0]).toEqual({ id: "en", label: "English" });
    expect(LOCALES).toEqual(expect.arrayContaining([{ id: "fr", label: "Français" }, { id: "es", label: "Español" }]));
  });

  it("include Spanish, with its formats", () => {
    prefs.set({ locale: "es" });
    expect(t("New task")).toBe("Nueva tarea");
    expect(tn(0, "{n} task", "{n} tasks")).toBe("0 tareas");
    expect(intlLocale()).toBe("es-ES");
  });
});
