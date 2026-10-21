import type { MessengerTab } from './messenger-view.vue'

import messages from '@proj-airi/i18n/locales/zh-Hans'

import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import MessengerView from './messenger-view.vue'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

async function mount(width: number) {
  await page.viewport(width, 780)
  document.documentElement.classList.add('aimy-misty-pink')
  onTestFinished(() => document.documentElement.classList.remove('aimy-misty-pink'))
  const container = document.createElement('div')
  container.style.cssText = 'width:100vw;height:100vh;container-type:inline-size'
  document.body.appendChild(container)
  onTestFinished(() => container.remove())
  const select = vi.fn()
  const contact = vi.fn()
  const tab = ref<MessengerTab>('chats')
  const screen = await render(defineComponent({
    setup: () => () => h(MessengerView, {
      'tab': tab.value,
      'onUpdate:tab': value => tab.value = value,
      'conversations': [
        { id: 'one', title: '小晴', preview: '下班后想散散步。', time: '18:30' },
        { id: 'two', title: '上周的旅行', preview: '想去看看海。', time: '昨天' },
      ],
      'contacts': [
        { id: 'sunny', name: '小晴', description: '温柔自然，有自己的想法' },
        { id: 'star', name: '星野', description: '热爱游戏与音乐' },
      ],
      'activeSessionId': 'one',
      'activeContactId': 'sunny',
      'activeName': '小晴',
      'onSelectSession': select,
      'onSelectContact': contact,
    }, {
      default: () => h('div', { style: 'padding:24px;height:100%;display:flex;flex-direction:column;gap:20px' }, [
        h('p', { style: 'background:var(--aimy-soft);padding:12px;border-radius:4px 20px 20px 20px;align-self:flex-start' }, '今天过得怎么样？'),
        h('p', { style: 'background:linear-gradient(115deg,var(--aimy-outgoing),var(--aimy-outgoing-end));color:var(--aimy-outgoing-ink);padding:12px;border-radius:20px 20px 4px 20px;align-self:flex-end' }, '下班后想散散步。'),
        h('textarea', { 'aria-label': '输入消息', 'style': 'margin-top:auto;background:white;padding:12px;resize:none;border:1px solid #ddd;border-radius:6px' }),
      ]),
      me: () => h('div', { style: 'padding:30px' }, [h('h2', '本机用户'), h('p', '关于我'), h('p', '全部设置')]),
    }),
  }), { container, global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hans', messages: { 'zh-Hans': messages } })] } })
  onTestFinished(() => screen.unmount())
  return { screen, select, contact, tab, container }
}

describe('messenger presentation', () => {
  it('switches tabs and filters real supplied lists without replacing the mounted draft', async () => {
    const { screen, select } = await mount(1000)
    const icon = document.querySelector('.messenger-nav-button [class*="i-lucide"]')!
    // NOTICE:
    // The browser test project emits no icon CSS, so no computed mask exists to assert.
    // The inline UnoCSS config in vitest.config.ts scans .vue files, and preset-icons
    // resolves masked rules through the node loader, which yields nothing in this page.
    // A production build does emit these rules: out/renderer/assets/main-*.css holds
    // i-lucide\:message-circle with a mask. Assert the class contract and the box size.
    // When the browser project generates icon rules, restore a mask assertion.
    expect(icon.className).toContain('i-lucide:message-circle')
    expect(icon.getBoundingClientRect().width).toBeGreaterThan(16)
    const input = screen.getByRole('textbox', { name: '输入消息' })
    await userEvent.fill(input, '尚未发送的内容')
    await screen.getByRole('button', { name: '角色', exact: true }).click()
    await expect.element(screen.getByText('星野', { exact: true })).toBeVisible()
    await screen.getByRole('button', { name: '我', exact: true }).click()
    await expect.element(screen.getByText('本机用户', { exact: true })).toBeVisible()
    await screen.getByRole('button', { name: '聊天', exact: true }).click()
    await expect.element(input).toHaveValue('尚未发送的内容')
    await userEvent.fill(screen.getByRole('textbox', { name: '搜索' }), '旅行')
    await expect.element(screen.getByText('上周的旅行', { exact: true })).toBeVisible()
    await screen.getByText('上周的旅行', { exact: true }).click()
    expect(select).toHaveBeenCalledWith('two')
    await page.screenshot({ path: '__screenshots__/messenger-wide.png' })
  })

  it('uses bottom navigation and a back-to-list action in a narrow window', async () => {
    const { screen, container, select } = await mount(390)
    await expect.element(screen.getByRole('textbox', { name: '输入消息' })).toBeVisible()
    await page.screenshot({ path: '__screenshots__/messenger-narrow.png' })
    await screen.getByRole('button', { name: '返回聊天列表' }).click()
    await expect.element(screen.getByText('上周的旅行', { exact: true })).toBeVisible()
    await screen.getByText('上周的旅行', { exact: true }).click()
    expect(select).toHaveBeenCalledWith('two')
    expect(container.scrollWidth).toBeLessThanOrEqual(391)
    await expect.element(page.elementLocator(screen.container.querySelector('.messenger-navigation')!)).not.toBeVisible()
    await screen.getByRole('button', { name: '返回聊天列表' }).click()
    await screen.getByRole('button', { name: '角色', exact: true }).click()
    await page.screenshot({ path: '__screenshots__/messenger-contacts.png' })
    await screen.getByRole('button', { name: '我', exact: true }).click()
    await page.screenshot({ path: '__screenshots__/messenger-me.png' })
  })
})
