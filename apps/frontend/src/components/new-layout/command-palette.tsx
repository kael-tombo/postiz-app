'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import useCookie from 'react-use-cookie';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { modeEmitter } from '@gitroom/frontend/components/layout/mode.component';

/**
 * Command palette (design ruleset N8): Ctrl/Cmd+K opens a keyboard-first
 * launcher for navigation and actions. Self-contained overlay (no modal
 * chrome), Esc/backdrop closes, arrows+Enter run. Tokens only; motion is
 * killed automatically under prefers-reduced-motion by global.scss.
 */

type Command = {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  group: 'actions' | 'goto';
  run: () => void;
};

export const CommandPalette = () => {
  const router = useRouter();
  const t = useT();
  const [mode, setMode] = useCookie('mode', 'dark');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => router.push(path);
    return [
      {
        id: 'new-post',
        label: t('cmd_new_post', 'Create a new post'),
        hint: t('cmd_hint_action', 'Action'),
        keywords: 'new post create compose schedule launch write',
        group: 'actions',
        run: () => {
          // Bridge to the calendar-scoped NewPost component: set the pending
          // flag first so it fires even if we are navigating from elsewhere.
          window.sessionStorage.setItem('sf-new-post-pending', '1');
          window.dispatchEvent(new CustomEvent('sf:new-post'));
          router.push('/launches');
        },
      },
      {
        id: 'add-channel',
        label: t('cmd_add_channel', 'Add a channel'),
        hint: t('cmd_hint_action', 'Action'),
        keywords: 'add channel connect integration social account provider',
        group: 'actions',
        run: () => go('/third-party'),
      },
      {
        id: 'toggle-theme',
        label:
          mode === 'dark'
            ? t('cmd_switch_light', 'Switch to light mode')
            : t('cmd_switch_dark', 'Switch to dark mode'),
        hint: t('cmd_hint_action', 'Action'),
        keywords: 'theme dark light mode appearance toggle',
        group: 'actions',
        run: () => {
          // mode.component listens and syncs cookie + body class.
          modeEmitter.emit('mode', mode === 'dark' ? 'light' : 'dark');
          setMode(mode === 'dark' ? 'light' : 'dark');
        },
      },
      {
        id: 'go-launches',
        label: t('calendar', 'Calendar'),
        hint: t('cmd_hint_goto', 'Go to'),
        keywords: 'calendar launches posts schedule',
        group: 'goto',
        run: () => go('/launches'),
      },
      {
        id: 'go-agents',
        label: t('cmd_agent', 'Agent'),
        hint: t('cmd_hint_goto', 'Go to'),
        keywords: 'agent ai chat copilot assistant',
        group: 'goto',
        run: () => go('/agents'),
      },
      {
        id: 'go-analytics',
        label: t('analytics', 'Analytics'),
        hint: t('cmd_hint_goto', 'Go to'),
        keywords: 'analytics stats charts repository stars',
        group: 'goto',
        run: () => go('/analytics'),
      },
      {
        id: 'go-media',
        label: t('media', 'Media'),
        hint: t('cmd_hint_goto', 'Go to'),
        keywords: 'media images videos uploads library',
        group: 'goto',
        run: () => go('/media'),
      },
      {
        id: 'go-plugs',
        label: t('plugs', 'Plugs'),
        hint: t('cmd_hint_goto', 'Go to'),
        keywords: 'plugs webhooks automation zapier n8n',
        group: 'goto',
        run: () => go('/plugs'),
      },
      {
        id: 'go-integrations',
        label: t('integrations', 'Integrations'),
        hint: t('cmd_hint_goto', 'Go to'),
        keywords: 'integrations channels accounts third-party',
        group: 'goto',
        run: () => go('/third-party'),
      },
      {
        id: 'go-settings',
        label: t('settings', 'Settings'),
        hint: t('cmd_hint_goto', 'Go to'),
        keywords: 'settings preferences teams webhooks developers',
        group: 'goto',
        run: () => go('/settings'),
      },
      {
        id: 'go-billing',
        label: t('billing', 'Billing'),
        hint: t('cmd_hint_goto', 'Go to'),
        keywords: 'billing subscription plan pricing payment',
        group: 'goto',
        run: () => go('/billing'),
      },
    ];
  }, [router, t, mode, setMode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return commands;
    }
    return commands.filter((c) =>
      (c.label + ' ' + c.keywords).toLowerCase().includes(q)
    );
  }, [commands, query]);

  const close = useCallback(() => setOpen(false), []);

  const runCommand = useCallback(
    (command: Command) => {
      close();
      // Let the overlay unmount before side effects (navigation/modals).
      setTimeout(() => command.run(), 0);
    },
    [close]
  );

  // Global Ctrl/Cmd+K toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Reset state and focus the input whenever it opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Keep the active option in view.
  useEffect(() => {
    document
      .getElementById(`sf-cmd-opt-${active}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, filtered]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const command = filtered[active];
        if (command) {
          runCommand(command);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    },
    [filtered, active, runCommand, close]
  );

  if (!open) {
    return null;
  }

  const groups: Array<Command['group']> =
    filtered.some((c) => c.group === 'actions') &&
    filtered.some((c) => c.group === 'goto')
      ? ['actions', 'goto']
      : [filtered[0]?.group ?? 'actions'];
  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-start justify-center pt-[14vh] bg-black/50 backdrop-blur-[2px]"
      onMouseDown={close}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('cmd_palette_title', 'Command palette')}
        className="w-[560px] max-w-[92vw] bg-newBgColorInner border border-[var(--new-border)] rounded-[16px] shadow-menu overflow-hidden animate-fadeIn"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls="sf-cmd-list"
          aria-activedescendant={
            filtered[active] ? `sf-cmd-opt-${active}` : undefined
          }
          aria-label={t('cmd_palette_title', 'Command palette')}
          placeholder={t('cmd_placeholder', 'Type a command or search…')}
          className="w-full h-[52px] px-[18px] bg-transparent outline-none border-0 border-b border-b-[var(--new-border)] text-[15px] text-newTextColor placeholder-textItemBlur"
        />
        <div
          id="sf-cmd-list"
          role="listbox"
          className="max-h-[320px] overflow-y-auto py-[6px]"
        >
          {filtered.length === 0 && (
            <div className="px-[18px] py-[16px] text-[13px] text-textItemBlur">
              {t('cmd_no_results', 'No matching commands')}
            </div>
          )}
          {groups.map((group) => (
            <div key={group}>
              {filtered.some((c) => c.group === group) && (
                <div className="px-[18px] pt-[8px] pb-[4px] text-[10px] font-[600] uppercase tracking-[0.08em] text-textItemBlur">
                  {group === 'actions'
                    ? t('cmd_group_actions', 'Actions')
                    : t('cmd_group_goto', 'Go to')}
                </div>
              )}
              {filtered
                .filter((c) => c.group === group)
                .map((command) => {
                  flatIndex++;
                  const isActive = flatIndex === active;
                  return (
                    <div
                      key={command.id}
                      id={`sf-cmd-opt-${flatIndex}`}
                      role="option"
                      aria-selected={isActive}
                      tabIndex={-1}
                      onMouseEnter={() => setActive(flatIndex)}
                      onClick={() => runCommand(command)}
                      className={clsx(
                        'flex items-center justify-between mx-[6px] px-[12px] h-[38px] rounded-[10px] cursor-pointer text-[14px] transition-colors',
                        isActive
                          ? 'bg-[var(--new-box-focused)] text-textItemFocused'
                          : 'text-newTextColor'
                      )}
                    >
                      <span className="truncate">{command.label}</span>
                      <span className="text-[11px] text-textItemBlur ms-[12px]">
                        {command.hint}
                      </span>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-[14px] px-[18px] h-[36px] border-t border-t-[var(--new-border)] text-[11px] text-textItemBlur">
          <span>↑↓ {t('cmd_navigate', 'navigate')}</span>
          <span>↵ {t('cmd_run', 'run')}</span>
          <span>esc {t('cmd_close', 'close')}</span>
          <span className="ms-auto">Ctrl/Cmd K</span>
        </div>
      </div>
    </div>
  );
};
