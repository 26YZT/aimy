import { VRMCore, VRMHumanoid } from '@pixiv/three-vrm-core'
import { AnimationClip, AnimationMixer, Group, Object3D, Quaternion, QuaternionKeyframeTrack, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { VrmGesturePlayer } from './gestures'

function createPlayer() {
  const scene = new Group()
  let boneIndex = 0
  function bone(parent: Object3D, x: number, y: number) {
    const node = new Object3D()
    node.name = `bone-${boneIndex++}`
    node.position.set(x, y, 0)
    parent.add(node)
    return { node }
  }
  const hips = bone(scene, 0, 0.9)
  const spine = bone(hips.node, 0, 0.25)
  const leftUpperArm = bone(spine.node, 0.2, 0.2)
  const leftLowerArm = bone(leftUpperArm.node, 0.2, 0)
  const rightUpperArm = bone(spine.node, -0.2, 0.2)
  const rightLowerArm = bone(rightUpperArm.node, -0.2, 0)
  const leftUpperLeg = bone(hips.node, 0.1, -0.1)
  const leftLowerLeg = bone(leftUpperLeg.node, 0, -0.4)
  const rightUpperLeg = bone(hips.node, -0.1, -0.1)
  const rightLowerLeg = bone(rightUpperLeg.node, 0, -0.4)
  const humanoid = new VRMHumanoid({
    hips,
    spine,
    leftUpperArm,
    leftLowerArm,
    rightUpperArm,
    rightLowerArm,
    leftUpperLeg,
    leftLowerLeg,
    rightUpperLeg,
    rightLowerLeg,
    head: bone(spine.node, 0, 0.45),
    leftHand: bone(leftLowerArm.node, 0.2, 0),
    rightHand: bone(rightLowerArm.node, -0.2, 0),
    leftFoot: bone(leftLowerLeg.node, 0, -0.1),
    rightFoot: bone(rightLowerLeg.node, 0, -0.1),
  })
  scene.add(humanoid.normalizedHumanBonesRoot)
  const vrm = new VRMCore({ scene, humanoid, meta: { metaVersion: '1', name: 'Gesture fixture', authors: ['Aimy'], licenseUrl: '' } })
  const mixer = new AnimationMixer(scene)
  const arm = humanoid.getNormalizedBoneNode('rightUpperArm')!
  const head = humanoid.getNormalizedBoneNode('head')!
  const idlePose = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 1.2)
  const idle = mixer.clipAction(new AnimationClip('idle', 10, [
    new QuaternionKeyframeTrack(`${arm.name}.quaternion`, [0, 10], [...idlePose.toArray(), ...idlePose.toArray()]),
  ])).play()
  mixer.update(0)
  humanoid.update()
  const player = new VrmGesturePlayer(vrm, mixer)
  const update = (delta: number) => {
    mixer.update(delta)
    player.update()
    humanoid.update()
  }
  return { player, vrm, mixer, idle, arm, head, idlePose, update }
}

describe('vrm gesture playback', () => {
  // ROOT CAUSE:
  // UUID gesture tracks and named VRMA tracks wrote the same bone through separate property mixers.
  // Constant gesture keyframes skipped their writes while moving idle keyframes kept writing.
  // Both clips now use the normalized bone name and share one additive binding.
  it('holds a gesture over changing VRMA idle tracks in the component mixer', () => {
    const { player, vrm, mixer, arm, idlePose } = createPlayer()
    const componentMixer = ref(mixer)
    mixer.stopAllAction()
    const nextIdlePose = idlePose.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.2))
    mixer.clipAction(new AnimationClip('moving-idle', 10, [
      new QuaternionKeyframeTrack(`${arm.name}.quaternion`, [0, 10], [...idlePose.toArray(), ...nextIdlePose.toArray()]),
    ])).play()
    mixer.update(0)
    player.play('wave')
    for (let i = 0; i < 30; i++) {
      componentMixer.value.update(0.05)
      player.update()
      vrm.humanoid.update()
    }
    expect(arm.quaternion.angleTo(idlePose)).toBeGreaterThan(0.5)
  })
  it('moves raw arm bones with a wave and returns to the running idle clip', () => {
    const { player, vrm, idle, arm, idlePose, update } = createPlayer()
    const rawArm = vrm.humanoid.getRawBoneNode('rightUpperArm')!
    const before = rawArm.quaternion.clone()

    expect(player.play('wave')).toBe(true)
    update(0.8)

    expect(before.angleTo(rawArm.quaternion)).toBeGreaterThan(0.5)
    expect(idle.isRunning()).toBe(true)
    update(2.3)
    expect(arm.quaternion.angleTo(idlePose)).toBeLessThan(0.001)
    expect(idle.isRunning()).toBe(true)
  })

  it('nods the head once and restores its pose', () => {
    const { player, vrm, head, update } = createPlayer()
    const original = head.quaternion.clone()
    const rawHead = vrm.humanoid.getRawBoneNode('head')!

    expect(player.play('nod')).toBe(true)
    update(0.3)
    expect(original.angleTo(rawHead.quaternion)).toBeGreaterThan(0.2)
    update(1)
    expect(original.angleTo(head.quaternion)).toBeLessThan(0.001)
  })

  it('replaces an active wave without leaving its arm pose or replaying it later', () => {
    const { player, arm, idlePose, update } = createPlayer()
    player.play('wave')
    update(0.8)

    expect(player.play('nod')).toBe(true)
    expect(arm.quaternion.angleTo(idlePose)).toBeLessThan(0.001)
    update(4)
    expect(arm.quaternion.angleTo(idlePose)).toBeLessThan(0.001)
  })

  it('stops immediately without advancing idle time and can play again', () => {
    const { player, mixer, arm, idlePose, update } = createPlayer()
    player.play('wave')
    update(1)
    const time = mixer.time

    expect(player.play('stop')).toBe(true)
    expect(mixer.time).toBe(time)
    expect(arm.quaternion.angleTo(idlePose)).toBeLessThan(0.001)
    expect(player.play('wave')).toBe(true)
    update(0.8)
    expect(arm.quaternion.angleTo(idlePose)).toBeGreaterThan(0.5)
  })
})
