import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';

export default function Layout() {
    return (
        <>
            <StatusBar 
                backgroundColor="#222222" 
                barStyle="light-content" 
                translucent={false}
            />
            <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />  
                <Stack.Screen name="main" />
            </Stack>
        </>
    );
}