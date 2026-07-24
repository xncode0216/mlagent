import {
  BarChart3,
  BookOpenCheck,
  BrainCircuit,
  Cpu,
  Database,
  History,
  PackageCheck,
  RefreshCw,
  ScanSearch,
  Search,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import {
  availableAgentCommands,
  filterAgentCommands,
  type AgentCommandDefinition,
  type AgentCommandId,
  type AgentCommandMode,
} from "./agentCommands";

const commandIcons: Record<AgentCommandId, typeof Database> = {
  profile: Database,
  clean: WandSparkles,
  transform: RefreshCw,
  train: BrainCircuit,
  gpu: Cpu,
  evaluate: BarChart3,
  diagnose: ScanSearch,
  iterate: RefreshCw,
  export: PackageCheck,
  learn: BookOpenCheck,
  continue: History,
};

function CommandOption({
  command,
  selected,
  onChoose,
}: {
  command: AgentCommandDefinition;
  selected: boolean;
  onChoose: (command: AgentCommandDefinition) => void;
}) {
  const Icon = commandIcons[command.id];
  return (
    <button
      aria-label={`${command.slash} ${command.label}`}
      aria-selected={selected}
      className={selected ? "selected" : ""}
      id={`agent-command-${command.id}`}
      onClick={() => onChoose(command)}
      role="option"
      type="button"
    >
      <Icon aria-hidden="true" size={17} />
      <span>
        <strong>{command.label}</strong>
        <small>{command.description}</small>
      </span>
      <code>{command.slash}</code>
    </button>
  );
}

export function CommandPalette({
  mode,
  onChoose,
  onClose,
}: {
  mode: AgentCommandMode;
  onChoose: (command: AgentCommandDefinition) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const commands = useMemo(
    () => filterAgentCommands(availableAgentCommands(mode), query),
    [mode, query],
  );

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function moveSelection(delta: number) {
    if (commands.length === 0) return;
    setActiveIndex((current) => (current + delta + commands.length) % commands.length);
  }

  function trapTab(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('input, button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="command-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-label="Agent 命令面板"
        aria-modal="true"
        className="command-palette"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          trapTab(event);
        }}
        ref={dialogRef}
        role="dialog"
      >
        <div className="command-palette-search">
          <Search aria-hidden="true" size={17} />
          <input
            aria-activedescendant={commands[activeIndex] ? `agent-command-${commands[activeIndex].id}` : undefined}
            aria-controls="agent-command-results"
            aria-label="搜索 Agent 命令"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveSelection(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveSelection(-1);
              } else if (event.key === "Enter" && commands[activeIndex]) {
                event.preventDefault();
                onChoose(commands[activeIndex]);
              }
            }}
            placeholder="搜索命令、阶段或目标"
            ref={searchRef}
            role="searchbox"
            value={query}
          />
          <button aria-label="关闭命令面板" onClick={onClose} title="关闭 (Esc)" type="button">
            <X aria-hidden="true" size={17} />
          </button>
        </div>
        <div aria-label="Agent 命令" className="command-results" id="agent-command-results" role="listbox">
          {commands.length > 0 ? (
            commands.map((command, index) => (
              <CommandOption
                command={command}
                key={command.id}
                onChoose={onChoose}
                selected={index === activeIndex}
              />
            ))
          ) : (
            <div className="command-empty" role="status">
              <strong>没有匹配的命令</strong>
              <span>尝试搜索“训练”“报告”或“重试”。</span>
            </div>
          )}
        </div>
        <footer>
          <span>↑↓ 选择</span>
          <span>Enter 插入</span>
          <span>Esc 关闭</span>
        </footer>
      </section>
    </div>
  );
}

export function SlashCommandSuggestions({
  activeIndex,
  commands,
  onChoose,
}: {
  activeIndex: number;
  commands: AgentCommandDefinition[];
  onChoose: (command: AgentCommandDefinition) => void;
}) {
  return (
    <div aria-label="Slash 命令建议" className="slash-command-suggestions" id="slash-command-results" role="listbox">
      {commands.map((command, index) => (
        <CommandOption command={command} key={command.id} onChoose={onChoose} selected={index === activeIndex} />
      ))}
    </div>
  );
}
