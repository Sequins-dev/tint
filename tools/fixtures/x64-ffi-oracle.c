#include <stdarg.h>
#include <stddef.h>

typedef struct { long a, b; } II;
typedef struct { long a; double b; } IS;
typedef struct { double a; long b; } SI;
typedef struct { double a, b; } SS;
typedef struct { float a; int b; double c; } Merge;
typedef struct { char tag; int value; short tail; } Padded;
typedef union { double f; unsigned long i; } Word;
typedef struct { Word word; double value; } Overlay;
typedef struct __attribute__((packed)) { char tag; double value; } PackedImage;
typedef struct { long a, b, c; } Big;

// The Tint caller inspects the returned register parts using C's own
// layout. Every function mutates one member of its by-value argument.
#define ROUND_TRIP(name, type)                                  \
  type oracle_##name(type input) {                             \
    input.b += 2;                                              \
    return input;                                              \
  }                                                           \
  int oracle_check_##name(const type *value) {                  \
    return value->a == 19 && value->b == 23;                     \
  }
ROUND_TRIP(ii, II)
ROUND_TRIP(is, IS)
ROUND_TRIP(si, SI)
ROUND_TRIP(ss, SS)

Merge oracle_merge(Merge input) {
  input.b += 2;
  return input;
}
int oracle_check_merge(const Merge *value) {
  return value->a == 7.25f && value->b == 23 && value->c == 8.5;
}

Overlay oracle_overlay(Overlay input) {
  input.word.i += 2;
  return input;
}
int oracle_check_overlay(const Overlay *value) {
  return value->word.i == 23 && value->value == 18.25;
}

PackedImage oracle_unaligned(PackedImage input) {
  input.value += 2;
  return input;
}
int oracle_check_unaligned(const PackedImage *value) {
  return value->tag == -7 && value->value == 23.25;
}

int oracle_layout(size_t padded, size_t tag, size_t value, size_t tail,
                  size_t overlay, size_t packed, size_t packed_value) {
  return padded == sizeof(Padded) && tag == offsetof(Padded, tag) &&
         value == offsetof(Padded, value) && tail == offsetof(Padded, tail) &&
         overlay == sizeof(Overlay) && offsetof(Overlay, value) == sizeof(Word) &&
         packed == sizeof(PackedImage) &&
         packed_value == offsetof(PackedImage, value) &&
         sizeof(long) == 8 && (char)-1 == -1;
}

Big oracle_big(Big input, long delta) {
  input.a += delta;
  input.c -= delta;
  __asm__ volatile("" : "+m"(input));
  return input;
}
int oracle_check_big(const Big *value) {
  return value->a == 21 && value->b == 23 && value->c == 12;
}

double oracle_gp_full(long a, long b, long c, long d, long e, long f,
                      IS mixed, double last) {
  return a + 2*b + 3*c + 4*d + 5*e + 6*f + mixed.a + mixed.b + last;
}

long oracle_sse_full(double a, double b, double c, double d, double e,
                     double f, double g, double h, SI mixed, long last) {
  return a + 2*b + 3*c + 4*d + 5*e + 6*f + 7*g + 8*h + mixed.a + mixed.b + last;
}

double oracle_variadic(int named, ...) {
  va_list list;
  va_start(list, named);
  int narrow = va_arg(list, int);
  double floating = va_arg(list, double);
  IS mixed = va_arg(list, IS);
  va_end(list);
  return named + narrow + floating + mixed.a + mixed.b;
}

__attribute__((naked)) int oracle_al(int named, ...) {
  __asm__("movzbl %al, %eax; ret");
}

double oracle_dynamic(long a, double b) {
  return a + b;
}

long oracle_borrow(unsigned char *bytes, long increment) {
  bytes[0] += increment;
  return bytes[0];
}
