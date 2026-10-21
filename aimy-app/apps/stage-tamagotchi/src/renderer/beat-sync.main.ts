import { defineInvoke, defineInvokeHandler } from '@moeru/eventa'
import { StageEnvironment } from '@proj-airi/stage-shared'
import {
  beatSyncBeatSignaledInvokeEventa,
  beatSyncGetInputByteFrequencyDataInvokeEventa,
  beatSyncGetStateInvokeEventa,
  beatSyncStateChangedInvokeEventa,
  beatSyncToggleInvokeEventa,
  beatSyncUpdateParametersInvokeEventa,
  createBeatSyncDetector,
  createContext,
} from '@proj-airi/stage-shared/beat-sync'
import { getResourcePolicy, onResourceRevoked, requestResourceAccess } from '@proj-airi/stage-ui/services/resource-policy'

import { installDesktopResourcePolicy, registerDesktopShutdownParticipant } from './bridges/resource-policy'

installDesktopResourcePolicy()

const context = createContext()
const signalState = defineInvoke(context, beatSyncStateChangedInvokeEventa)
const signalBeat = defineInvoke(context, beatSyncBeatSignaledInvokeEventa)
const detector = createBeatSyncDetector({ env: StageEnvironment.Tamagotchi })

detector.on('stateChange', state => void signalState(state))
detector.on('beat', (event) => {
  if (getResourcePolicy()?.state.screen.enabled)
    void signalBeat(event)
})
onResourceRevoked((_, kind) => {
  if (!kind || kind === 'screen')
    detector.stop()
})
registerDesktopShutdownParticipant({ id: 'beat-sync', stop: () => detector.stop(), flush: () => {} })

defineInvokeHandler(context, beatSyncToggleInvokeEventa, async (enabled) => {
  if (enabled) {
    await requestResourceAccess('screen')
    const lease = getResourcePolicy()?.acquire('screen')
    try {
      await detector.startScreenCapture()
      lease?.assertCurrent()
    }
    catch (error) {
      detector.stop()
      throw error
    }
    finally {
      lease?.release()
    }
  }
  else {
    detector.stop()
  }
})
defineInvokeHandler(context, beatSyncGetStateInvokeEventa, async () => detector.state)
defineInvokeHandler(context, beatSyncUpdateParametersInvokeEventa, async params => detector.updateParameters(params))
defineInvokeHandler(context, beatSyncGetInputByteFrequencyDataInvokeEventa, async () => detector.getInputByteFrequencyData())
