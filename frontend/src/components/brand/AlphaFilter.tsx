import { ALPHABET, cn } from '../../lib/utils'
import { Container } from '../layout/Container'

type AlphaFilterProps = {
  activeLetter: string | null
  availableLetters: Set<string>
  onSelect: (letter: string | null) => void
}

export function AlphaFilter({ activeLetter, availableLetters, onSelect }: AlphaFilterProps) {
  return (
    <div className="sticky top-16 z-40 border-b border-border bg-bg/95 backdrop-blur-md sm:top-20">
      <Container className="py-3 sm:py-4">
        <div className="flex flex-wrap items-center gap-0.5 sm:gap-1">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={cn(
              'px-2 py-1.5 text-xs tracking-wide transition-colors duration-300',
              activeLetter === null
                ? 'text-text underline decoration-accent underline-offset-4'
                : 'text-text-secondary hover:text-text',
            )}
          >
            All
          </button>

          {ALPHABET.map((letter) => {
            const available = availableLetters.has(letter)
            return (
              <button
                key={letter}
                type="button"
                disabled={!available}
                onClick={() => onSelect(letter)}
                className={cn(
                  'min-w-7 px-1 py-1.5 text-xs tracking-wide transition-colors duration-300',
                  activeLetter === letter
                    ? 'text-text underline decoration-accent underline-offset-4'
                    : available
                      ? 'text-text-secondary hover:text-text'
                      : 'cursor-default text-border',
                )}
              >
                {letter}
              </button>
            )
          })}
        </div>
      </Container>
    </div>
  )
}
