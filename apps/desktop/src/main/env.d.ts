declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
declare const PACKAGED_DEVELOPMENT: boolean;
declare const PACKAGED_RELEASE: boolean;

declare module 'electron-squirrel-startup' {
  const handled: boolean;
  export default handled;
}
