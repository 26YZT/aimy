import type { ChatHistoryItem } from '../../../../types/chat'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import ChatHistory from './history.vue'

import '@proj-airi/ui/main.css'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0))
    await close()
  document.documentElement.classList.remove('dark')
})

const portrait = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#bed9d1"/><circle cx="40" cy="28" r="14" fill="#37665a"/><path d="M12 80v-5a28 28 0 0 1 56 0v5" fill="#37665a"/></svg>')}`
const start = new Date('2026-10-20T03:22:00Z').getTime()
const messages: ChatHistoryItem[] = [
  { id: 'u1', role: 'user', content: '今天下班有点累，想找你说说话。', createdAt: start },
  { id: 'a1', role: 'assistant', content: '回来啦，先歇一会儿。\n\n今天最让你累的是什么？', slices: [], tool_results: [], createdAt: start + 1000 },
  { id: 'u2', role: 'user', content: '事情一件接一件。不过现在能坐下来，已经好多了。', replyToMessageId: 'a1', createdAt: start + 2000 },
  { id: 'a2', role: 'assistant', content: '那今晚就**慢慢来**吧。\n\n我们聊点轻松的，也可以安静待一会儿。', slices: [], tool_results: [], createdAt: start + 3000 },
]

async function mount(appearance: 'stage' | 'messenger', width = 400) {
  await page.viewport(900, 800)
  const pinia = createPinia()
  const screen = render(ChatHistory, {
    props: { messages, appearance, assistantLabel: 'ReLU', userLabel: '我', assistantAvatar: portrait, userAvatar: undefined, style: `height: 550px; width: ${width}px;` },
    global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })
  screen.container.style.width = `${width + 32}px`
  screen.container.style.padding = '16px'
  screen.container.style.boxSizing = 'border-box'
  screen.container.style.background = document.documentElement.classList.contains('dark') ? '#19171f' : '#ffffff'
  cleanup.push(async () => {
    await screen.unmount()
    disposePinia(pinia)
  })
  await expect.poll(() => screen.container.querySelectorAll('.chat-message-item-container').length).toBe(4)
  return screen
}

it.each([
  ['light', 350],
  ['light', 680],
  ['dark', 350],
] as const)('keeps messenger avatars, type and bubbles inside a %s %spx history', async (theme, width) => {
  await page.viewport(900, 800)
  document.documentElement.classList.toggle('dark', theme === 'dark')
  const screen = await mount('messenger', width)
  const bubbles = Array.from(screen.container.querySelectorAll<HTMLElement>('.chat-message-item-container'))
  const boundary = screen.container.getBoundingClientRect()
  for (const bubble of bubbles) {
    expect(getComputedStyle(bubble).fontSize).toBe('16px')
    expect(getComputedStyle(bubble).boxShadow).toBe('none')
    expect(bubble.getBoundingClientRect().left).toBeGreaterThanOrEqual(boundary.left)
    expect(bubble.getBoundingClientRect().right).toBeLessThanOrEqual(boundary.right)
  }
  const incoming = screen.container.querySelector<HTMLElement>('.messenger-incoming')!
  const backgroundRed = Number.parseInt(getComputedStyle(incoming).backgroundColor.slice(4))
  if (theme === 'dark')
    expect(backgroundRed).toBeLessThan(90)
  else
    expect(backgroundRed).toBeGreaterThan(220)
  expect(screen.container.querySelectorAll('[role="img"]')).toHaveLength(2)
  expect(screen.container.querySelectorAll('strong')).toHaveLength(1)
  await expect.element(screen.getByText('慢慢来', { exact: true })).toBeVisible()
  await page.elementLocator(screen.container).screenshot({ path: `__screenshots__/history-${theme}-${width}.png` })
})

it('keeps message actions and reply links in messenger appearance', async () => {
  const screen = await mount('messenger')
  await screen.getByRole('button', { name: 'Message actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Reply', exact: true }).click()
  expect(screen.emitted('replyMessage')?.[0]).toEqual([{ message: expect.objectContaining({ id: 'u1' }), label: '我' }])
  await screen.getByRole('button', { name: 'Message actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  expect(screen.emitted('deleteMessage')?.[0]).toEqual([{ message: expect.objectContaining({ id: 'u1' }), index: 0, key: 'u1' }])
})

it('retains the stage appearance without adding avatars', async () => {
  const screen = await mount('stage')
  expect(screen.container.querySelectorAll('[role="img"]')).toHaveLength(0)
  expect(screen.container.querySelectorAll('[data-appearance="stage"]')).toHaveLength(4)
  expect(screen.container.querySelectorAll('.font-cute')).toHaveLength(4)
})
