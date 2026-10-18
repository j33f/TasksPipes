<script lang="ts" module>
  const PATHS = {
    home: "M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z",
    inbox: "M4 13h4.5l1.5 2.5h4l1.5-2.5H20M6.5 5h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z",
    plus: "M12 5v14M5 12h14",
    close: "M6 6l12 12M18 6 6 18",
    lock: "M7 11h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2zM8 11V8a4 4 0 1 1 8 0v3",
    globe: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM4 12h16M12 4c2.2 2.3 3.2 5 3.2 8s-1 5.7-3.2 8c-2.2-2.3-3.2-5-3.2-8s1-5.7 3.2-8z",
    users: "M9 5.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4zM3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M15.5 6.2a3 3 0 0 1 0 5.6M17.5 14.8c1.5.6 2.6 2 3 4.2",
    doc: "M7 3.5h6.5L18 8v12a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20zM13 3.5V8h5M9.5 12.5h5M9.5 16h5",
    calendar: "M6 5.5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2zM4 10h16M8.5 3.5v4M15.5 3.5v4",
    send: "M4 12 20 4l-5 16-3-7zM12 13l8-9",
    return: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
    check: "m5 12.5 4.5 4.5L19 7.5",
    comment: "M5 5.5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4.5 3.5v-3.5H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z",
    arrow: "M5 12h14M13 6l6 6-6 6",
    settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6",
    logout: "M14 4.5h4a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10",
    menu: "M4 7h16M4 12h16M4 17h16",
    trash: "M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13",
    edit: "M5 19h4L19 9l-4-4L5 15zM13.5 6.5l4 4",
    search: "M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-4.5-4.5",
    pipe: "M5.2 4.5h1.6c.7 0 1.2.5 1.2 1.2v12.6c0 .7-.5 1.2-1.2 1.2H5.2c-.7 0-1.2-.5-1.2-1.2V5.7c0-.7.5-1.2 1.2-1.2zM11.2 4.5h1.6c.7 0 1.2.5 1.2 1.2v7.6c0 .7-.5 1.2-1.2 1.2h-1.6c-.7 0-1.2-.5-1.2-1.2V5.7c0-.7.5-1.2 1.2-1.2zM17.2 4.5h1.6c.7 0 1.2.5 1.2 1.2v3.6c0 .7-.5 1.2-1.2 1.2h-1.6c-.7 0-1.2-.5-1.2-1.2V5.7c0-.7.5-1.2 1.2-1.2z",
    user: "M12 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5",
    link: "M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-.8.8M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l.8-.8",
    unlink: "M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-.8.8M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l.8-.8M4 4l16 16",
    more: "M5 12a1 1 0 1 0 2 0 1 1 0 0 0-2 0zM11 12a1 1 0 1 0 2 0 1 1 0 0 0-2 0zM17 12a1 1 0 1 0 2 0 1 1 0 0 0-2 0z",
    pin: "M9.5 4h5l-.8 5.5 3.3 3.5H7l3.3-3.5zM12 13v7",
    chevron: "m9 6 6 6-6 6",
    star: "M12 4l2.5 5.1 5.6.8-4 3.9.9 5.6L12 16.8l-5 2.6.9-5.6-4-3.9 5.6-.8z",
    flag: "M5 21V4M5 4h11l-2 4 2 4H5",
    briefcase: "M4 8h16v11H4zM9 8V5.5h6V8M4 13h16",
    megaphone: "M4 10v4h3l7 4V6l-7 4zM17 9.5a3 3 0 0 1 0 5M7 14l1 5h2.5l-1-5",
    graduation: "M2.5 9.5 12 5l9.5 4.5L12 14zM6.5 11.5v4c1.5 1.5 3.5 2.2 5.5 2.2s4-.7 5.5-2.2v-4M21.5 9.5V15",
    book: "M4 5.5C6 4.5 9 4.5 12 6c3-1.5 6-1.5 8-.5V19c-2-1-5-1-8 .5-3-1.5-6-1.5-8-.5zM12 6v13.5",
    target: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11.5v1",
    euro: "M17 6.5A6.5 6.5 0 1 0 17 17.5M4.5 10.5h9M4.5 13.5h9",
    shield: "M12 3.5 19 6v5.5c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6zM9 12l2 2 4-4",
    clipboard: "M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2M9 3.5h6v3H9zM8.5 13l2 2 4-4",
    bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
    heart: "M12 19.5s-7.5-4.4-7.5-9.7A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6c0 5.3-7.5 9.7-7.5 9.7z",
    bolt: "M13 3 5 13.5h6L10 21l8-10.5h-6z",
    folder: "M4 6.5a1 1 0 0 1 1-1h4.5l2 2H19a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z",
    phone: "M6.5 4h3l1.5 4-2 1.5a10 10 0 0 0 5.5 5.5l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.5 1.5A15.5 15.5 0 0 1 5 5.5 1.5 1.5 0 0 1 6.5 4z",
    mail: "M4 6h16v12H4zM4 7l8 6 8-6",
    chart: "M4 20h16M7 16v-5M12 16V7M17 16v-8",
    archive: "M4 5h16v4H4zM5.5 9v10h13V9M10 13h4",
    checklist: "M10 6.5h10M10 12h10M10 17.5h10M3.5 6.5l1.5 1.5 2.5-2.5M3.5 12l1.5 1.5L7.5 11M3.5 17.5 5 19l2.5-2.5",
    play: "M8 5.5v13l10.5-6.5z",
    grip: "M9.5 6.5h.01M9.5 12h.01M9.5 17.5h.01M14.5 6.5h.01M14.5 12h.01M14.5 17.5h.01",
    skip: "M6 6l7 6-7 6zM17 6v12",
    info: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 11v5M12 8h.01",
    branch: "M7 4v10M7 14a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17 5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17 10c0 4-10 2-10 4",
    merge: "M7 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM7 9.5V20M17 14.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM7 9.5c0 4 10 2 10 5",
    history: "M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 8v4l3 2",
  } as const;
  export type IconName = keyof typeof PATHS;
  export const isIconName = (v: string): v is IconName => v in PATHS;
  /** A catalog icon name (task type…), with a fallback. */
  export const iconOf = (v: string | null | undefined, fallback: IconName = "check"): IconName => (v && isIconName(v) ? v : fallback);
</script>

<script lang="ts">
  let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0">
  <path d={PATHS[name]} />
</svg>
