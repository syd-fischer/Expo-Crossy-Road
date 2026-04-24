import { GLView } from "expo-gl";
import React, { Component } from "react";
import {
  Animated,
  Dimensions,
  StyleSheet,
  Platform,
  Vibration,
  View,
  Text,
  useColorScheme,
  TouchableOpacity,
} from "react-native";
import { useLocalSearchParams } from "expo-router";

import GestureRecognizer, { swipeDirections } from "@/components/GestureView";
import Score from "@/components/ScoreText";
import Engine from "@/GameEngine";
import State from "@/state";
import CharacterSelectScreen from "@/screens/CharacterSelectScreen";
import GameOverScreen from "@/screens/GameOverScreen";
import HomeScreen from "@/screens/HomeScreen";
import SettingsScreen from "@/screens/SettingsScreen";
import GameContext from "@/context/GameContext";

const DEBUG_CAMERA_CONTROLS = false;

class Game extends Component {
  /// Reserve State for UI related updates...
  state = {
    ready: false,
    score: 0,
    viewKey: 0,
    gameState: State.Game.none,
    showSettings: false,
    showCharacterSelect: false,
    // gameState: State.Game.gameOver
  };

  transitionScreensValue = new Animated.Value(1);

  UNSAFE_componentWillReceiveProps(nextProps, nextState) {
    if (nextState.gameState && nextState.gameState !== this.state.gameState) {
      this.updateWithGameState(nextState.gameState, this.state.gameState);
    }
    if (this.engine && nextProps.character !== this.props.character) {
      this.engine._hero.setCharacter(nextProps.character);
    }
    if (this.engine && this.engine.gameMap && nextProps.learningMode !== this.props.learningMode) {
      this.engine.gameMap.learningMode = nextProps.learningMode;
    }
  }

  transitionToGamePlayingState = () => {
    Animated.timing(this.transitionScreensValue, {
      toValue: 0,
      useNativeDriver: true,
      duration: 200,
      onComplete: ({ finished }) => {
        this.engine.setupGame(this.props.character, this.props.learningMode);
        this.engine.init();

        if (finished) {
          Animated.timing(this.transitionScreensValue, {
            toValue: 1,
            useNativeDriver: true,
            duration: 300,
          }).start();
        }
      },
    }).start();
  };

  updateWithGameState = (gameState) => {
    if (!gameState) throw new Error("gameState cannot be undefined");

    if (gameState === this.state.gameState) {
      return;
    }
    const lastState = this.state.gameState;

    this.setState({ gameState });
    this.engine.gameState = gameState;
    const { playing, gameOver, paused, none } = State.Game;
    switch (gameState) {
      case playing:
        if (lastState === paused) {
          this.engine.unpause();
        } else if (lastState !== none) {
          this.transitionToGamePlayingState();
        } else {
          // Coming straight from the menu.
          this.engine._hero.stopIdle();
          this.onSwipe(swipeDirections.SWIPE_UP);
        }

        break;
      case gameOver:
        break;
      case paused:
        this.engine.pause();
        break;
      case none:
        if (lastState === gameOver) {
          this.transitionToGamePlayingState();
        }
        this.newScore();

        break;
      default:
        break;
    }
  };

  componentWillUnmount() {
    cancelAnimationFrame(this.engine.raf);
    // Dimensions.removeEventListener("change", this.onScreenResize);
  }

  async componentDidMount() {
    // AudioManager.sounds.bg_music.setVolumeAsync(0.05);
    // await AudioManager.playAsync(
    //   AudioManager.sounds.bg_music, true
    // );

    Dimensions.addEventListener("change", this.onScreenResize);
  }

  onScreenResize = ({ window }) => {
    this.engine.updateScale();
  };

  UNSAFE_componentWillMount() {


    this.engine = new Engine(this.props.seed);
    if (!this.engine) return; // shouldn't happen, but protects the lines below
    this.engine.gameSpeed = 3;

    // this.engine.hideShadows = this.hideShadows;
    this.engine.onUpdateScore = (position) => {
      if (this.state.score < position) this.setState({ score: position });
    };
    this.engine.onGameInit = () => this.setState({ score: 0 });
    this.engine._isGameStateEnded = () => this.state.gameState !== State.Game.playing;
    this.engine.onGameReady = () => this.setState({ ready: true });
    this.engine.onGameEnded = () => {
      this.setState({ gameState: State.Game.gameOver });
    };
     this.engine._currentCharacter = this.props.character;

    // Turn on AI mode (this opens the websocket)
    this.engine.enableAI();

  }

  newScore = () => {
    Vibration.cancel();
    // this.props.setGameState(State.Game.playing);
    this.setState({ score: 0 });
    this.engine.init();
  };

  onSwipe = (gestureName) => this.engine.moveWithDirection(gestureName);

  renderGame = () => {
    if (!this.state.ready) return;

    return (
      <GestureView
        pointerEvents={DEBUG_CAMERA_CONTROLS ? "none" : undefined}
        onStartGesture={this.engine.beginMoveWithDirection}
        onSwipe={this.onSwipe}
      >
        <GLView
          style={{ flex: 1, height: "100%", overflow: "hidden" }}
          onContextCreate={this.engine._onGLContextCreate}
        />
      </GestureView>
    );
  };

  renderGameOver = () => {
    if (this.state.gameState !== State.Game.gameOver) {
      return null;
    }

    return (
      <View style={StyleSheet.absoluteFillObject}>
        <GameOverScreen
          showSettings={() => {
            this.setState({ showSettings: true });
          }}
          setGameState={(state) => {
            this.updateWithGameState(state);
          }}
        />
      </View>
    );
  };

  renderHomeScreen = () => {
    if (this.state.gameState !== State.Game.none) {
      return null;
    }

    return (
      <View style={StyleSheet.absoluteFillObject}>
        <HomeScreen
          onPlay={() => {
            this.updateWithGameState(State.Game.playing);
          }}
          onShowCharacterSelect={() => {
            this.setState({ showCharacterSelect: true });
          }}
        />
      </View>
    );
  };

  renderSettingsScreen() {
    return (
      <View style={StyleSheet.absoluteFillObject}>
        <SettingsScreen
          goBack={() => this.setState({ showSettings: false })}
          setCharacter={this.props.setCharacter}
          learningMode={this.props.learningMode}
          setLearningMode={this.props.setLearningMode}
        />
      </View>
    );
  }

  renderCharacterSelectScreen() {
    return (
      <View style={StyleSheet.absoluteFillObject}>
        <CharacterSelectScreen
          navigation={{
            goBack: () => this.setState({ showCharacterSelect: false }),
          }}
          setCharacter={this.props.setCharacter}
        />
      </View>
    );
  }

  renderCameraControls = () => {
    if (!this.engine || !this.engine.aiMode || this.state.gameState !== State.Game.playing) {
      return null;
    }

    const setCameraMode = (mode: 'all' | 'lead' | number) => {
      this.engine.cameraMode = mode;
      // Force update to re-render buttons if needed (though mode is on engine)
      this.forceUpdate();
    };

    const nextPlayer = () => {
      let currentIndex = typeof this.engine.cameraMode === 'number' ? this.engine.cameraMode : -1;
      const heroes = this.engine._heroes || [];
      const len = heroes.length;

      if (len === 0) return;

      // Find next alive player
      for (let i = 1; i <= len; i++) {
        const checkIndex = (currentIndex + i) % len;
        if (heroes[checkIndex] && heroes[checkIndex].isAlive) {
          setCameraMode(checkIndex);
          break;
        }
      }
    };

    return (
      <View style={{ position: 'absolute', bottom: 40, right: 20, zIndex: 100, flexDirection: 'row', gap: 10 }}>
        <TouchableOpacity
          onPress={() => setCameraMode('all')}
          style={{ backgroundColor: this.engine.cameraMode === 'all' ? '#000' : '#fff', padding: 10, borderRadius: 5 }}
        >
          <Text style={{ color: this.engine.cameraMode === 'all' ? '#fff' : '#000' }}>All</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setCameraMode('lead')}
          style={{ backgroundColor: this.engine.cameraMode === 'lead' ? '#000' : '#fff', padding: 10, borderRadius: 5 }}
        >
          <Text style={{ color: this.engine.cameraMode === 'lead' ? '#fff' : '#000' }}>Lead</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={nextPlayer}
          style={{ backgroundColor: typeof this.engine.cameraMode === 'number' ? '#000' : '#fff', padding: 10, borderRadius: 5 }}
        >
          <Text style={{ color: typeof this.engine.cameraMode === 'number' ? '#fff' : '#000' }}>Next Player</Text>
        </TouchableOpacity>
      </View>
    );
  };

  render() {
    const { isDarkMode, isPaused } = this.props;

    return (
      <View
        pointerEvents="box-none"
        style={[
          StyleSheet.absoluteFill,
          { flex: 1, backgroundColor: "#87C6FF" },
          Platform.select({
            web: { position: "fixed" },
            default: { position: "absolute" },
          }),
          this.props.style,
        ]}
      >
        <Animated.View
          style={{ flex: 1, opacity: this.transitionScreensValue }}
        >
          {this.renderGame()}
        </Animated.View>
        <Score
          score={this.state.score}
          gameOver={this.state.gameState === State.Game.gameOver}
        />
        <Text style={{ position: "absolute", top: 40, right: 20, zIndex: 100, fontWeight: "bold" }}>Seed: {this.engine?.seed}</Text>
        {this.renderGameOver()}

        {this.renderHomeScreen()}

        {this.state.showSettings && this.renderSettingsScreen()}

        {this.state.showCharacterSelect && this.renderCharacterSelectScreen()}

        {this.renderCameraControls()}

        {isPaused && (
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: "rgba(105, 201, 230, 0.8)",
                justifyContent: "center",
                alignItems: "center",
              },
            ]}
          />
        )}
      </View>
    );
  }
}

const GestureView = ({ onStartGesture, onSwipe, ...props }) => {
  const config = {
    velocityThreshold: 0.2,
    directionalOffsetThreshold: 80,
  };

  return (
    <GestureRecognizer
      onResponderGrant={() => {
        onStartGesture();
      }}
      onSwipe={(direction) => {
        onSwipe(direction);
      }}
      config={config}
      onTap={() => {
        onSwipe(swipeDirections.SWIPE_UP);
      }}
      style={{ flex: 1 }}
      {...props}
    />
  );
};

function GameScreen(props) {
  const scheme = useColorScheme();
  const { character, setCharacter, learningMode, setLearningMode } = React.useContext(GameContext);
React.useContext(GameContext);

  // ✅ Add this:
  const { seed } = useLocalSearchParams<{ seed: string }>();
  
  return (
    <Game
      {...props}
      character={character}
      setCharacter={setCharacter}
      learningMode={learningMode}
      setLearningMode={setLearningMode}
      isDarkMode={scheme === "dark"}
      seed={seed}
    />
  );
}

export default GameScreen;
