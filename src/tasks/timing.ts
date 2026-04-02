export function delay(min: number, max: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, min + Math.random() * (max - min));
  });
}
