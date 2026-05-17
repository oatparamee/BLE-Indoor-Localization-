import React, {useEffect, useState} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {StatusBar, View, Text, StyleSheet, ActivityIndicator} from 'react-native';
import {loadApiUrl} from './src/config/api';

import SetupScreen from './src/screens/SetupScreen';
import SiteSurveyScreen from './src/screens/SiteSurveyScreen';
import FusionScreen from './src/screens/FusionScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import BoelterNavigationScreen from './src/screens/BoelterNavigationScreen';

const Tab = createBottomTabNavigator();

function TabIcon({label, focused}: {label: string; focused: boolean}) {
  const icons: Record<string, string> = {
    Beacons: '📌',
    Survey: '🗺',
    Fusion: '🎯',
    Navigation: '🧭',
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
          name="Beacons"
          component={SetupScreen}
          options={{
            title: 'Beacon Setup',
            tabBarIcon: ({focused}) => (
              <TabIcon label="Beacons" focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="Survey"
          component={SiteSurveyScreen}
          options={{
            title: 'Site Survey',
            tabBarIcon: ({focused}) => (
              <TabIcon label="Survey" focused={focused} />
            ),
          }}
        />
        <Tab.Screen
          name="Fusion"
          component={FusionScreen}
          options={{
            title: 'Sensor Fusion',
            tabBarIcon: ({focused}) => (
              <TabIcon label="Fusion" focused={focused} />
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
