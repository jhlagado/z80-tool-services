export const readCliOptionValue = (
  arguments_: readonly string[],
  index: number,
  name: string,
  valueName = 'value',
): string => {
  const value = arguments_[index + 1];
  if (value === undefined) {
    throw new Error(`${name} requires a ${valueName}`);
  }
  return value;
};
