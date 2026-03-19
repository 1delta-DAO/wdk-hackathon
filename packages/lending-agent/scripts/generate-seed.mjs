import { generateMnemonic } from 'bip39'

// 12-word mnemonic (128 bits of entropy)
const mnemonic12 = generateMnemonic(128)
console.log('12-word mnemonic:')
console.log(mnemonic12)
console.log()

// 24-word mnemonic (256 bits of entropy)
const mnemonic24 = generateMnemonic(256)
console.log('24-word mnemonic:')
console.log(mnemonic24)
