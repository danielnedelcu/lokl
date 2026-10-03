<template>
  <Toaster
    class="toaster group"
    :visible-toasts="5"
    close-button
    :duration="7000"
    :theme="$colorMode.value == 'dark' ? 'dark' : 'light'"
    :style="{
      '--normal-bg': 'var(--popover)',
      '--normal-text': 'var(--popover-foreground)',
      '--normal-border': 'var(--border)',
    }"
    :toast-options="{
      class: 'items-start!',
      classes: {
        icon: 'mt-0.5',
        toast:
          'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
        description: 'group-[.toast]:text-muted-foreground',
        // lokl change: errors are tinted with the destructive colour (the
        // icon and words still say it's an error, not the colour alone).
        // `!` because the toast's own bg-background and border-border above
        // apply to every toast and would otherwise win.
        error:
          'group-[.toaster]:border-destructive/40! group-[.toaster]:bg-[color-mix(in_oklab,var(--destructive)_8%,var(--background))]! [&_[data-icon]]:text-destructive! [&_[data-title]]:text-destructive!',
        actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
        cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
      },
    }"
  />
</template>
