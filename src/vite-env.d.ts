/// <reference types="vite/client" />

declare module '*.wgsl?raw' {
  const shaderCode: string;
  export default shaderCode;
}
