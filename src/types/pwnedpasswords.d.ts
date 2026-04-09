declare module 'pwnedpasswords' {
  const pwnedpasswords: (password: string) => Promise<number>;

  export default pwnedpasswords;
}
