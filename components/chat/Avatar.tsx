export function Avatar({ peerId }: { peerId: number }) {
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-subtle font-mono text-xs font-medium"
    >
      {String(peerId).slice(0, 3)}
    </span>
  );
}
