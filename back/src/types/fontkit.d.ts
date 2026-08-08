declare module "fontkit" {
  const fontkit: {
    create(buffer: Uint8Array): unknown;
  };
  export default fontkit;
}
