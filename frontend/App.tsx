import React, {useEffect, useState} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {StatusBar, View, Text, StyleSheet, ActivityIndicator} from 'react-native';
import {loadApiUrl} from './src/config/api';

import CalibrationScreen from './src/screens/CalibrationScreen';
import LiveReadingsScreen from './src/screens/LiveReadingsScreen';
import PositionScreen from './src/screens/PositionScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import BoelterNavigationScreen from './src/screens/BoelterNavigationScreen';

const Tab = createBottomTabNavigator();

function TabIcon({label, focused}: {label: string; focused: boolean}) {
  const icons: Record<string, string> = {
    Calibration: '⚙',
    Readings: '📡',
    Position: '📍',
    Navigation: '🗺',
    Settings: '🔧',
  };
  return (
    <View style={tabStyles.iconContainer}>
      <Text style={[tabStyles.icon, focused && tabStyles.iconFocused]}>
        {icons[label] || '•'}
      </Text>
    </View>
  );
}

const tabStyles = StyleSheet.create({
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 20,
    opacity: 0.5,
  },
  iconFocused: {
    opacity: 1.0,
  },
});

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadApiUrl().then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <View style={{flex: 1, backgroundColor: '#0d1117', justifyContent: 'center', alignItems: 'center'}}>
        <ActivityIndicator size="large" color="#58a6ff" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
      <Tab.Navigator
        screenOptions={{
          headerStyle: {backgroundColor: '#161b22', borderBottomColor: '#30363d'},
          headerTintColor: '#e6edf3',
          tabBarStyle: {
            backgroundColor: '#161b22',
            borderTopColor: '#30363d',
          },
          tabBarActiveTintColor: '#58a6ff',
          tabBarInactiveTintColor: '#8b949e',
        }}>
        <Tab.Screen
          name="Calibration"
          component={CalibrationScreen}
          options={{
            tabBarIcon: ({focused}) => (
              <TabIcon label="Calibration" focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="Readings"
          component={LiveReadingsScreen}
          options={{
            title: 'Live Readings',
            tabBarIcon: ({focused}) => (
              <TabIcon label="Readings" focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="Position"
          component={PositionScreen}
          options={{
            tabBarIcon: ({focused}) => (
              <TabIcon label="Position" focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="Navigation"
          component={BoelterNavigationScreen}
          options={{
            title: 'Navigation',
            tabBarIcon: ({focused}) => (
              <TabIcon label="Navigation" focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            tabBarIcon: ({focused}) => (
              <TabIcon label="Settings" focused={focused} />
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
