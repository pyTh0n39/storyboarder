const THREE = require('three')
const { produce } = require('immer')
const crypto = require('crypto')

const hashify = string => crypto.createHash('sha1').update(string).digest('base64')

const capitalize = string => string.charAt(0).toUpperCase() + string.slice(1)

//
//
// selectors
//
const getIsSceneDirty = state => {
  let current = hashify(JSON.stringify(getSerializedState(state)))
  return current !== state.meta.lastSavedHash
}
// return only the stuff we want to save to JSON
const getSerializedState = state => {
  let sceneObjects = Object.entries(state.sceneObjects)
    .reduce((o, [ k, v ]) => {
      let {
        // ignore 'loaded'
        loaded: _,
        // but allow serialization of the rest
        ...serializable
      } = v
      o[k] = serializable
      return o
    }, {})

  return {
    world: state.world,
    sceneObjects,
    activeCamera: state.activeCamera
  }
}

//
//
// state helper functions
//
const checkForCharacterChanges = (state, draft, action) => {
  // if characterPresetId wasn't just set
  if (!action.payload.hasOwnProperty('characterPresetId')) {
    // check to see if character has changed from preset
    // and invalidate if so
    let characterPresetId = draft.sceneObjects[action.payload.id].characterPresetId
    if (characterPresetId) {
      let statePreset = state.presets.characters[characterPresetId]

      // preset does not exist anymore
      if (!statePreset) {
        // so don't reference it
        draft.sceneObjects[action.payload.id].characterPresetId = undefined
        return true
      }

      let stateCharacter = draft.sceneObjects[action.payload.id]

      // for every top-level prop in the preset
      for (let prop in statePreset.state) {
        // if the prop is a number or a string
        if (
          typeof statePreset.state[prop] === 'number' ||
          typeof statePreset.state[prop] === 'string' ||
          typeof statePreset.state[prop] === 'undefined'
        ) {
          // if it differs

          if (stateCharacter[prop] != statePreset.state[prop]) {
            // changed, no longer matches preset
            draft.sceneObjects[action.payload.id].characterPresetId = undefined
            return true
          }
        }
      }

      // hardcode check of second-level props
      if (
        stateCharacter.morphTargets.mesomorphic != statePreset.state.morphTargets.mesomorphic ||
        stateCharacter.morphTargets.ectomorphic != statePreset.state.morphTargets.ectomorphic ||
        stateCharacter.morphTargets.endomorphic != statePreset.state.morphTargets.endomorphic
      ) {
        // changed, no longer matches preset
        draft.sceneObjects[action.payload.id].characterPresetId = undefined
        return true
      }
    }
  }}

const checkForSkeletonChanges = (state, draft, action) => {
  // if posePresetId wasn't just set
  if (!action.payload.hasOwnProperty('posePresetId')) {
    // check to see if pose has changed from preset
    // and invalidate if so
    let posePresetId = draft.sceneObjects[action.payload.id].posePresetId
    if (posePresetId) {
      let statePreset = state.presets.poses[posePresetId]

      // preset does not exist anymore
      if (!statePreset) {
        // so don't reference it
        draft.sceneObjects[action.payload.id].posePresetId = undefined
        return true
      }

      let stateSkeleton = state.sceneObjects[action.payload.id].skeleton

      let preset = statePreset.state.skeleton
      let curr = stateSkeleton

      if (Object.values(curr).length != Object.values(preset).length) {
        // changed, no longer matches preset
        draft.sceneObjects[action.payload.id].posePresetId = undefined
        return true
      }

      for (name in preset) {
        if (
          preset[name].rotation.x !== curr[name].rotation.x ||
          preset[name].rotation.y !== curr[name].rotation.y ||
          preset[name].rotation.z !== curr[name].rotation.z
        ) {
          // changed, no longer matches preset
          draft.sceneObjects[action.payload.id].posePresetId = undefined
          return true
        }
      }
    }
  }
}

// migrate SceneObjects from older beta builds of Shot Generator 2.0
const migrateRotations = sceneObjects =>
  Object.entries(sceneObjects)
    .reduce((o, [ k, v ]) => {
      if (v.type === 'object' && typeof v.rotation === 'number') {
        v = {
          ...v,
          rotation: {
            x: 0,
            y: v.rotation,
            z: 0
          }
        }
      }
      o[k] = v
      return o
    }, {})

const updateMeta = state => {
  state.meta.lastSavedHash = hashify(JSON.stringify(getSerializedState(state)))
}

// `loaded` status is not serialized
// when we load a new file, we need to initialize it
// so it can be read to determine loading progress
const resetLoadingStatus = sceneObjects => {
  for (let key in sceneObjects) {
    if (
      sceneObjects[key].type === 'character' ||
      sceneObjects[key].type === 'object' ||
      sceneObjects[key].type === 'volume'
    ) {
      sceneObjects[key] = {
        ...sceneObjects[key],
        loaded: sceneObjects[key].loaded == null
          ? false
          : sceneObjects[key].loaded
      }
    }
  }
  return sceneObjects
}

// decorate each SceneObject with a calculated displayName
const withDisplayNames = sceneObjects => {
  let countByType = {}

  for (let id in sceneObjects) {
    let sceneObject = sceneObjects[id]

    countByType[sceneObject.type] = countByType[sceneObject.type]
      ? countByType[sceneObject.type] + 1
      : 1

    let number = countByType[sceneObject.type]
    let displayName = capitalize(`${sceneObject.type} ${number}`)

    if (sceneObjects[id].displayName !== displayName) {
      // mutate
      sceneObjects[id] = {
        ...sceneObjects[id],
        displayName
      }
    }
  }

  return sceneObjects
}

// load up the default poses
const defaultPosePresets = require('./shot-generator-presets/poses.json')
 
// reference AE56DD1E-3F6F-4A74-B247-C8A6E3EB8FC0 as our Default Pose
const defaultPosePreset = defaultPosePresets['AE56DD1E-3F6F-4A74-B247-C8A6E3EB8FC0']

const defaultCharacterPreset = {
  height: 1.6256,
  model: 'adult-female',
  headScale: 1,
  // gender: 'female',
  // age: 'adult'
  morphTargets: {
    mesomorphic: 0,
    ectomorphic: 0,
    endomorphic: 0
  },
  name: undefined
}

const defaultScenePreset = {
  world: {
    ground: false,
    backgroundColor: 0xFFFFFF,
    room: {
      visible: true,
      width: 30,
      length: 40,
      height: 30
    },
    environment: {
      file: undefined,
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
      scale: 1,
      visible: true
    },
    ambient: {
      intensity: 0.1
    },
    directional: {
      intensity: 0.5,
      rotation: -0.9,
      tilt: 0.75
    }
  },
  sceneObjects: {
    'C2062AFC-D710-4C7D-942D-A3BAF8A76D5C': {
      id: 'C2062AFC-D710-4C7D-942D-A3BAF8A76D5C',
      type: 'object',
      model: 'box',
      width: 1,
      height: 1,
      depth: 1,
      x: 0,
      y: 0,
      z: 0,
      rotation: { x: 0, y: 0, z: 0 },
      name: undefined,
      visible: true
    },
    'D8B95127-6C04-40A9-B592-8870EEAF43A8': {
      id: 'D8B95127-6C04-40A9-B592-8870EEAF43A8',
      type: 'object',
      model: 'chair',
      width: 1,
      height: 1,
      depth: 1,
      x: 2,
      y: 0.5,
      z: 0,
      rotation: { x: 0, y: 0, z: 0 },
      name: undefined,
      visible: true
    },
    '94FA0F9D-E1E8-436B-8041-D831BD06CB33': {
      id: '94FA0F9D-E1E8-436B-8041-D831BD06CB33',
      type: 'object',
      model: 'box',
      width: .5,
      height: .5,
      depth: .5,
      x: -2,
      y: -2,
      z: 0,
      rotation: { x: 0, y: 2, z: 0 },
      name: undefined,
      visible: true
    },
    'A1A35319-82D1-4A24-98FE-136836750A61': {
      // non-preset properties
      id: 'A1A35319-82D1-4A24-98FE-136836750A61',
      type: 'character',
      x: 1,
      y: 0,
      z: 0,
      rotation: 0,
      visible: true,

      // character preset properties
      characterPresetId: '7C694D0F-9D45-4B74-BA70-38479E520091',
      ...defaultCharacterPreset,

      // pose preset properties
      posePresetId: defaultPosePreset.id,
      skeleton: defaultPosePreset.skeleton
    },

    '4F0FF9B8-BBB4-4D83-9E87-6EFE16A01D6F': {
      id: '4F0FF9B8-BBB4-4D83-9E87-6EFE16A01D6F',
      type: 'light',
      x: 1,
      y: 1.5,
      z: 2,
      rotation: 10,
      tilt: 10,
      intensity: 0.7,
      visible: true,
      angle: 1.04,
      distance: 3,
      penumbra: 0,
      decay: 1,
    },

    '6BC46A44-7965-43B5-B290-E3D2B9D15EEE': {
      id: '6BC46A44-7965-43B5-B290-E3D2B9D15EEE',
      type: 'camera',
      fov: 22.25,
      x: 0,
      y: 6,
      z: 1,
      rotation: -0.0,
      tilt: 0,
      roll: 0.0,
      name: undefined
    },
  },
  activeCamera: '6BC46A44-7965-43B5-B290-E3D2B9D15EEE',
}

const initialScene = {
  world: {
    ground: true,
    backgroundColor: 0xFFFFFF,
    room: {
      visible: false,
      width: 30,
      length: 40,
      height: 30
    },
    environment: {
      file: undefined,
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
      scale: 1,
      visible: true
    },
    ambient: {
      intensity: 0.5
    },
    directional: {
      intensity: 0.5,
      rotation: -0.9,
      tilt: 0.75
    }

  },
  sceneObjects: {
    '6BC46A44-7965-43B5-B290-E3D2B9D15EEE': {
      id: '6BC46A44-7965-43B5-B290-E3D2B9D15EEE',
      type: 'camera',
      fov: 22.25,
      x: 0,
      y: 6,
      z: 1,
      rotation: 0,
      tilt: 0,
      roll: 0.0,
      name: undefined
    },

  },
  activeCamera: '6BC46A44-7965-43B5-B290-E3D2B9D15EEE',
}

// TODO sg key
const initialState = {
  models: {
    'adult-female': {
      id: 'adult-female',
      name: 'Adult Female',
      type: 'character',
      height: 1.65
    },
    'adult-male': {
      id: 'adult-male',
      name: 'Adult Male',
      type: 'character',
      height: 1.8
    },
    'teen-female': {
      id: 'teen-female',
      name: 'Teen Female',
      type: 'character',
      height: 1.6
    },
    'teen-male': {
      id: 'teen-male',
      name: 'Teen Male',
      type: 'character',
      height: 1.6
    },

    'box': {
      id: 'box',
      name: 'box',
      type: 'object',
      height: 1
    },
    'tree': {
      id: 'tree',
      name: 'tree',
      type: 'object',
      height: 1
    },
    'chair': {
      id: 'chair',
      name: 'chair',
      type: 'object',
      height: 1
    },
    'car': {
      id: 'car',
      name: 'car',
      type: 'object',
      height: 1
    },
    'door': {
      id: 'door',
      name: 'door',
      type: 'object',
      height: 1
    },
    'building': {
      id: 'building_one_storey',
      name:  'building (1)',
      type: 'object',
      height: 1
    }
  },

  attachments: {},

  aspectRatio: 2.35,

  board: {},

  meta: {
    storyboarderFilePath: undefined,
    lastSavedHash: undefined
  },

  workspace: {
    guides: {
      center: false,
      thirds: false
    }
  },

  ...{
    ...initialScene,
    sceneObjects: withDisplayNames(initialScene.sceneObjects)
  },

  selection: undefined,
  selectedBone: undefined,
  mainViewCamera: 'live', // 'ortho' or 'live'
  input: {
    accel: [0, 0, 0],
    mag: [0, 0, 0],
    sensor: [0, 0, 0, 0],
    down: false,
    mouseMode: false,
    orbitMode: false
  },
  devices: {
    0: {
      analog: {
        lStickX: 127,
        lStickY: 127,
        rStickX: 127,
        rStickY: 127
      },
      motion: {
        gryoPitch: 0,
        gyroRoll: 0,
        gyroYaw: 0
      },
      digital: {
        circle: false
      }
    }
  },
  presets: {
    scenes: {
      'C181CF19-AF44-4348-8BCB-FB3EE582FC5D': {
        id: 'C181CF19-AF44-4348-8BCB-FB3EE582FC5D',
        name: 'Default Scene',
        state: defaultScenePreset
      }
    },

    characters: {
      '7C694D0F-9D45-4B74-BA70-38479E520091': {
        id: '7C694D0F-9D45-4B74-BA70-38479E520091',
        name: 'Default Character',
        state: defaultCharacterPreset
      }
    },

    poses: defaultPosePresets
  },
  server: {
    uri: undefined,
    client: false
  }
}

module.exports = {
  initialState,

  reducer: (state = initialState, action) => {
    return produce(state, draft => {
      switch (action.type) {
        case 'LOAD_SCENE':
          draft.world = {
            ...action.payload.world
          }

          // migrate older scenes which were missing ambient and directional light settings
          if (!action.payload.world.ambient) draft.world.ambient = initialScene.world.ambient
          if (!action.payload.world.directional) draft.world.directional = initialScene.world.directional

          draft.sceneObjects = withDisplayNames(resetLoadingStatus(migrateRotations(action.payload.sceneObjects)))
          draft.activeCamera = action.payload.activeCamera
          // clear selections
          draft.selection = undefined
          draft.selectedBone = undefined
          draft.mainViewCamera = 'live'
          updateMeta(draft)
          return

        case 'SELECT_OBJECT':
          // if the selection has changed
          if (draft.selection != action.payload) {
            // make the selection
            draft.selection = action.payload
            // de-select any currently selected bone
            draft.selectedBone = undefined
          }
          return

        case 'CREATE_OBJECT':
          // let id = Object.values(draft.sceneObjects).length + 1
          let id = action.payload.id != null
            ? action.payload.id
            : THREE.Math.generateUUID()
          draft.sceneObjects[id] = {
            ...action.payload, id
          }
          draft.sceneObjects = withDisplayNames(draft.sceneObjects)
          return

        case 'DELETE_OBJECT':
          if (draft.sceneObjects[action.payload.id] == null) return
          delete draft.sceneObjects[action.payload.id]

          // was the current selection just removed?
          if (draft.selection === action.payload.id) {
            // set selection to null
            draft.selection = null
            // de-select any currently selected bone
            draft.selectedBone = undefined
          }
          draft.sceneObjects = withDisplayNames(draft.sceneObjects)
          return

        case 'UPDATE_OBJECT':
          if (draft.sceneObjects[action.payload.id] == null) return
          
          // TODO is there a simpler way to merge only non-null values?

          // update skeleton first
          // so that subsequent changes to height and headScale take effect
          if (action.payload.hasOwnProperty('skeleton')) {
            draft.sceneObjects[action.payload.id].skeleton = action.payload.skeleton
          }

          if (action.payload.x != null) {
            draft.sceneObjects[action.payload.id].x = action.payload.x
          }
          if (action.payload.y != null) {
            draft.sceneObjects[action.payload.id].y = action.payload.y
          }
          if (action.payload.z != null) {
            draft.sceneObjects[action.payload.id].z = action.payload.z
          }

          if (action.payload.fov != null) {
            draft.sceneObjects[action.payload.id].fov = action.payload.fov
          }
          if (action.payload.rotation != null) {
            if (draft.sceneObjects[action.payload.id].type === 'object') {
              // MERGE
              draft.sceneObjects[action.payload.id].rotation = {
                ...state.sceneObjects[action.payload.id].rotation,
                ...action.payload.rotation
              }
            } else {
              draft.sceneObjects[action.payload.id].rotation = action.payload.rotation
            }
          }
          if (action.payload.tilt != null) {
            draft.sceneObjects[action.payload.id].tilt = action.payload.tilt
          }
          if (action.payload.roll != null) {
            draft.sceneObjects[action.payload.id].roll = action.payload.roll
          }
          if (action.payload.model != null) {
            draft.sceneObjects[action.payload.id].model = action.payload.model

            // if a character's model is changing
            if (draft.sceneObjects[action.payload.id].type === 'character') {
              // reset the height ...
              draft.sceneObjects[action.payload.id].height = state.models[action.payload.model]
                // ... to default (if known) ...
                ? state.models[action.payload.model].height
                // ... otherwise, a reasonable value
                : 1.6
            }
          }

          if (action.payload.width != null) {
            draft.sceneObjects[action.payload.id].width = action.payload.width
          }
          if (action.payload.height != null) {
            draft.sceneObjects[action.payload.id].height = action.payload.height
          }
          if (action.payload.depth != null) {
            draft.sceneObjects[action.payload.id].depth = action.payload.depth
          }

          if (action.payload.headScale != null) {
            draft.sceneObjects[action.payload.id].headScale = action.payload.headScale
          }

          if (action.payload.morphTargets != null) {
            Object.entries(action.payload.morphTargets).forEach(([key, value]) => {
              draft.sceneObjects[action.payload.id].morphTargets[key] = value
            })
          }

          // allow a null value for name
          if (action.payload.hasOwnProperty('name')) {
            draft.sceneObjects[action.payload.id].name = action.payload.name
          }

          if (action.payload.visible != null) {
            draft.sceneObjects[action.payload.id].visible = action.payload.visible
          }

          if (action.payload.intensity != null) {
            draft.sceneObjects[action.payload.id].intensity = action.payload.intensity
          }

          if (action.payload.angle != null) {
            draft.sceneObjects[action.payload.id].angle = action.payload.angle
          }

          if (action.payload.penumbra != null) {
            draft.sceneObjects[action.payload.id].penumbra = action.payload.penumbra
          }

          if (action.payload.decay != null) {
            draft.sceneObjects[action.payload.id].decay = action.payload.decay
          }

          if (action.payload.distance != null) {
            draft.sceneObjects[action.payload.id].distance = action.payload.distance
          }



          // for volumes
          if (action.payload.numberOfLayers != null) {
            draft.sceneObjects[action.payload.id].numberOfLayers = action.payload.numberOfLayers
          }
          if (action.payload.distanceBetweenLayers != null) {
            draft.sceneObjects[action.payload.id].distanceBetweenLayers = action.payload.distanceBetweenLayers
          }
          if (action.payload.opacity != null) {
            draft.sceneObjects[action.payload.id].opacity = action.payload.opacity
          }
          if (action.payload.color != null) {
            draft.sceneObjects[action.payload.id].color = action.payload.color
          }
          if (action.payload.volumeImageAttachmentIds != null) {
            draft.sceneObjects[action.payload.id].volumeImageAttachmentIds = action.payload.volumeImageAttachmentIds
          }



          if (action.payload.hasOwnProperty('characterPresetId')) {
            draft.sceneObjects[action.payload.id].characterPresetId = action.payload.characterPresetId
          }

          if (action.payload.hasOwnProperty('posePresetId')) {
            draft.sceneObjects[action.payload.id].posePresetId = action.payload.posePresetId
          }

          if (action.payload.hasOwnProperty('loaded')) {
            draft.sceneObjects[action.payload.id].loaded = action.payload.loaded
          }
          

          checkForCharacterChanges(state, draft, action)
          checkForSkeletonChanges(state, draft, action)
          return

        case 'DUPLICATE_OBJECT':
          let source = draft.sceneObjects[action.payload.id]
          if (source) {
            let object = {
              ...source,
              name: source.name == null ? null : source.name + ' copy',
              x: source.x + (Math.random() * 2 - 1),
              y: source.y + (Math.random() * 2 - 1),
              z: source.z,
              id: action.payload.destinationId
            }
            draft.sceneObjects[action.payload.destinationId] = object
            draft.sceneObjects = withDisplayNames(draft.sceneObjects)
          }
          return

        case 'UPDATE_CHARACTER_SKELETON':
          draft.sceneObjects[action.payload.id].skeleton = draft.sceneObjects[action.payload.id].skeleton || {}
          draft.sceneObjects[action.payload.id].skeleton[action.payload.name] = {
            rotation: action.payload.rotation
          }
          checkForSkeletonChanges(state, draft, action)
          return

        case 'SET_INPUT_ACCEL':
          draft.input.accel = action.payload
          return

          case 'SET_INPUT_MAG':
          draft.input.mag = action.payload
          return

          case 'SET_INPUT_SENSOR':
          draft.input.sensor = action.payload
          return

        case 'SET_INPUT_DOWN':
          draft.input.down = action.payload
          return

        case 'SET_INPUT_MOUSEMODE':
          draft.input.mouseMode = action.payload
          return

        case 'SET_INPUT_ORBITMODE':          
          draft.input.orbitMode = action.payload
          return

        case 'UPDATE_MODELS':
          draft.models = {
            ...state.models,
            ...action.payload
          }
          return

        case 'SET_ASPECT_RATIO':
          draft.aspectRatio = action.payload
          return

        case 'SELECT_BONE':
          //console.log('trying to get bone with id: ', action.payload)
          draft.selectedBone = action.payload
          return

        case 'SET_MAIN_VIEW_CAMERA':
          draft.mainViewCamera = action.payload
          return

        case 'SET_ACTIVE_CAMERA':
          draft.activeCamera = action.payload
          return

        case 'CREATE_SCENE_PRESET':
          draft.presets.scenes[action.payload.id] = action.payload
          return

        case 'DELETE_SCENE_PRESET':
          delete draft.presets.scenes[action.payload.id]
          return

        case 'UPDATE_SCENE_PRESET':
          // allow a null value for name
          if (action.payload.hasOwnProperty('name')) {
            draft.presets.scenes[action.payload.id].name = action.payload.name
          }
          return

        case 'UPDATE_DEVICE':
          draft.devices[action.payload.id] = action.payload
          return

        case 'CREATE_CHARACTER_PRESET':
          draft.presets.characters[action.payload.id] = action.payload
          return

        case 'CREATE_POSE_PRESET':
          draft.presets.poses[action.payload.id] = action.payload
          return

        case 'DELETE_POSE_PRESET':
          delete draft.presets.poses[action.payload.id]
          return

        case 'UPDATE_POSE_PRESET':
          // allow a null value for name
          if (action.payload.hasOwnProperty('name')) {
            draft.presets.poses[action.payload.id].name = action.payload.name
          }
          return     

        case 'UPDATE_WORLD':
          if (action.payload.hasOwnProperty('ground')) {
            draft.world.ground = action.payload.ground
          }
          if (action.payload.hasOwnProperty('backgroundColor')) {
            draft.world.backgroundColor = action.payload.backgroundColor
          }
          return

        case 'UPDATE_WORLD_ROOM':
          if (action.payload.hasOwnProperty('width')) { draft.world.room.width = action.payload.width }
          if (action.payload.hasOwnProperty('length')) { draft.world.room.length = action.payload.length }
          if (action.payload.hasOwnProperty('height')) { draft.world.room.height = action.payload.height }
          if (action.payload.hasOwnProperty('visible')) { draft.world.room.visible = action.payload.visible }
          return

        case 'UPDATE_WORLD_ENVIRONMENT':
          if (action.payload.hasOwnProperty('file')) {
            draft.world.environment.file = action.payload.file
          }
          if (action.payload.scale != null) {
            draft.world.environment.scale = action.payload.scale
          }
          if (action.payload.visible != null) {
            draft.world.environment.visible = action.payload.visible
          }
          if (action.payload.rotation != null) {
            draft.world.environment.rotation = action.payload.rotation
          }
          if (action.payload.x != null) {
            draft.world.environment.x = action.payload.x
          }
          if (action.payload.y != null) {
            draft.world.environment.y = action.payload.y
          }
          if (action.payload.z != null) {
            draft.world.environment.z = action.payload.z
          }
          if (action.payload.intensity != null) {
            draft.world.ambient.intensity = action.payload.intensity
          }
          if (action.payload.intensityDirectional != null) {
            draft.world.directional.intensity = action.payload.intensityDirectional
          }
          if (action.payload.rotationDirectional != null) {
            draft.world.directional.rotation = action.payload.rotationDirectional
          }
          if (action.payload.tiltDirectional != null) {
            draft.world.directional.tilt = action.payload.tiltDirectional
          }
          return

        case 'UPDATE_SERVER':
          console.log('%cshot-generator web client at', 'color:blue', action.payload.uri)
          draft.server = { ...draft.server, ...action.payload }
          return

        case 'SET_BOARD':
          draft.board = action.payload
          return

        case 'MARK_SAVED':
          updateMeta(draft)
          return

        case 'SET_META_STORYBOARDER_FILE_PATH':
          draft.meta.storyboarderFilePath = action.payload
          return

        case 'TOGGLE_WORKSPACE_GUIDE':
          draft.workspace.guides[action.payload] = !draft.workspace.guides[action.payload]
          return

        case 'ATTACHMENTS_PENDING':
          draft.attachments[action.payload.id] = { status: 'NotAsked' }
          return
        case 'ATTACHMENTS_LOAD':
          draft.attachments[action.payload.id] = { status: 'Loading' }
          return
        case 'ATTACHMENTS_SUCCESS':
          draft.attachments[action.payload.id] = { status: 'Success', value: action.payload.value }
          return
        case 'ATTACHMENTS_ERROR':
          draft.attachments[action.payload.id] = { status: 'Error', error: action.payload.error }
          return

        case 'ATTACHMENTS_DELETE':
          delete draft.attachments[action.payload.id]
          return

        case 'ATTACHMENTS_RELOCATE':
          let { src, dst } = action.payload
          for (let id in draft.sceneObjects) {
            let sceneObject = draft.sceneObjects[id]

            if (sceneObject.model === src) {
              sceneObject.model = dst
            }
          }
          return
      }
    })
  },

  //
  //
  // action creators
  //
  selectObject: id => ({ type: 'SELECT_OBJECT', payload: id }),
  selectBone: id => ({ type: 'SELECT_BONE', payload: id }),

  createObject: values => ({ type: 'CREATE_OBJECT', payload: values }),
  updateObject: (id, values) => ({ type: 'UPDATE_OBJECT', payload: { id, ...values } }),
  
  deleteObject: id => ({ type: 'DELETE_OBJECT', payload: { id } }),

  duplicateObject: (id, destinationId) => ({ type: 'DUPLICATE_OBJECT', payload: { id, destinationId } }),

  setMainViewCamera: name => ({ type: 'SET_MAIN_VIEW_CAMERA', payload: name }),

  loadScene: data => ({ type: 'LOAD_SCENE', payload: data }),

  updateCharacterSkeleton: ({ id, name, rotation }) => ({
    type: 'UPDATE_CHARACTER_SKELETON',
    payload: { id, name, rotation }
  }),

  setActiveCamera: id => ({ type: 'SET_ACTIVE_CAMERA', payload: id }),

  resetScene: () => ({
    type: 'LOAD_SCENE',
    payload: {
      world: initialState.world,
      sceneObjects: initialState.sceneObjects,
      activeCamera: initialState.activeCamera
    }
  }),

  createScenePreset: payload => ({ type: 'CREATE_SCENE_PRESET', payload }),
  updateScenePreset: (id, values) => ({ type: 'UPDATE_SCENE_PRESET', payload: { id, ...values} }),
  deleteScenePreset: id => ({ type: 'DELETE_SCENE_PRESET', payload: { id } }),

  createCharacterPreset: payload => ({ type: 'CREATE_CHARACTER_PRESET', payload }),

  createPosePreset: payload => ({ type: 'CREATE_POSE_PRESET', payload }),
  updatePosePreset: (id, values) => ({ type: 'UPDATE_POSE_PRESET', payload: { id, ...values} }),
  deletePosePreset: id => ({ type: 'DELETE_POSE_PRESET', payload: { id } }),

  updateWorld: payload => ({ type: 'UPDATE_WORLD', payload }),
  updateWorldRoom: payload => ({ type: 'UPDATE_WORLD_ROOM', payload }),
  updateWorldEnvironment: payload => ({ type: 'UPDATE_WORLD_ENVIRONMENT', payload }),

  updateDevice: (id, values) => ({ type: 'UPDATE_DEVICE', payload: { id, ...values } }),

  updateServer: payload => ({ type: 'UPDATE_SERVER', payload }),

  setBoard: payload => ({ type: 'SET_BOARD', payload }),
  
  markSaved: () => ({ type: 'MARK_SAVED' }),

  toggleWorkspaceGuide: payload => ({ type: 'TOGGLE_WORKSPACE_GUIDE', payload }),

  //
  //
  // selectors
  //
  getSerializedState,
  getIsSceneDirty
}
