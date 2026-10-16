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
    unlink: "M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-.8.8M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l.8-.8M4 4l16 16",
    archive: "M4 5h16v4H4zM5.5 9v10h13V9M10 13h4",
    history: "M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 8v4l3 2",
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0">
  <path d={PATHS[name]} />
</svg>
