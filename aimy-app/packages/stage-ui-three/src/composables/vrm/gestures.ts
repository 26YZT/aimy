import type { VRMCore, VRMHumanBoneName } from '@pixiv/three-vrm-core'
import type { AnimationAction, AnimationMixer, Object3D } from 'three'

import { AnimationClip, AnimationUtils, LoopOnce, Quaternion, QuaternionKeyframeTrack, Vector3 } from 'three'

/** Built-in gestures overlay the current idle pose and return to idle after one playback. */
export type VrmGesture = 'wave' | 'nod' | 'stop'

function rotationTrack(bone: Object3D, times: number[], poses: Quaternion[]) {
  // VRMA tracks use names. A UUID alias creates a second binding that idle overwrites during held poses.
  return new QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, poses.flatMap(pose => pose.toArray()))
}

function pointBone(child: Object3D, direction: Vector3, parentRotation: Quaternion) {
  const target = direction.clone().applyQuaternion(parentRotation.clone().invert()).normalize()
  return new Quaternion().setFromUnitVectors(child.position.clone().normalize(), target)
}

function createGestureClip(vrm: VRMCore, gesture: Exclude<VrmGesture, 'stop'>) {
  const getBone = (name: VRMHumanBoneName) => vrm.humanoid.getNormalizedBoneNode(name)
  if (gesture === 'nod') {
    const head = getBone('head')
    if (!head)
      return undefined

    const base = head.quaternion.clone()
    const down = base.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.28))
    return new AnimationClip('nod', 1.2, [rotationTrack(head, [0, 0.3, 0.6, 0.9, 1.2], [base, down, base, down, base])])
  }

  const upper = getBone('rightUpperArm')
  const lower = getBone('rightLowerArm')
  const hand = getBone('rightHand')
  const opposite = getBone('leftUpperArm')
  const hips = getBone('hips')
  const head = getBone('head')
  if (!upper?.parent || !lower || !hand || !opposite || !hips || !head)
    return undefined

  vrm.scene.updateMatrixWorld(true)
  // Derive directions from this rig, so VRM 0 and VRM 1 use their own facing convention.
  const side = upper.getWorldPosition(new Vector3()).sub(opposite.getWorldPosition(new Vector3())).normalize()
  const up = head.getWorldPosition(new Vector3()).sub(hips.getWorldPosition(new Vector3())).normalize()
  const parentRotation = upper.parent.getWorldQuaternion(new Quaternion())
  const upperTarget = pointBone(lower, side.clone().addScaledVector(up, 0.15), parentRotation)
  const lowerTarget = pointBone(hand, up.clone().addScaledVector(side, 0.1), parentRotation.clone().multiply(upperTarget))
  const upperBase = upper.quaternion.clone()
  const lowerBase = lower.quaternion.clone()
  const handBase = hand.quaternion.clone()
  const left = handBase.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.4))
  const right = handBase.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.4))
  const times = [0, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.5, 3]

  return new AnimationClip('wave', 3, [
    rotationTrack(upper, times, [upperBase, upperTarget, upperTarget, upperTarget, upperTarget, upperTarget, upperTarget, upperTarget, upperBase]),
    rotationTrack(lower, times, [lowerBase, lowerTarget, lowerTarget, lowerTarget, lowerTarget, lowerTarget, lowerTarget, lowerTarget, lowerBase]),
    rotationTrack(hand, times, [handBase, handBase, left, right, left, right, left, handBase, handBase]),
  ])
}

/**
 * Owns one transient gesture on the model's existing mixer. No timers or persisted commands are used.
 * Call update after the mixer advances. Call cancel before pausing, detaching, or replacing the model.
 */
export class VrmGesturePlayer {
  private action?: AnimationAction
  private clip?: AnimationClip

  constructor(private readonly vrm: VRMCore, private readonly mixer: AnimationMixer) {}

  play(gesture: VrmGesture): boolean {
    if (gesture !== 'wave' && gesture !== 'nod' && gesture !== 'stop')
      return false
    this.cancel()
    if (gesture === 'stop')
      return true
    const clip = createGestureClip(this.vrm, gesture)
    if (!clip)
      return false

    // Additive deltas leave the idle clip running and prevent two absolute poses from averaging.
    AnimationUtils.makeClipAdditive(clip)
    this.clip = clip
    this.action = this.mixer.clipAction(clip).setLoop(LoopOnce, 1).play()
    return true
  }

  update() {
    if (this.action && !this.action.isRunning())
      this.cancel()
  }

  cancel() {
    if (!this.action || !this.clip)
      return

    this.action.stop()
    this.mixer.uncacheClip(this.clip)
    this.action = undefined
    this.clip = undefined
    this.mixer.update(0)
    this.vrm.humanoid.update()
  }
}
