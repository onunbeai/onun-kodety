export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };
export type JSONObject = { [key: string]: JSONValue };
export type CSSUnit = 'px' | 'rem' | 'em' | '%' | 'vw' | 'vh';
export type ControlCategory =
  | 'Content' | 'Layout' | 'Style' | 'Typography' | 'Effects'
  | 'Animation' | 'Data' | 'Events' | 'Advanced';

export enum ControlType {
  String = 'string', Text = 'text', Number = 'number', Boolean = 'boolean', Enum = 'enum',
  Color = 'color', Image = 'image', File = 'file', Link = 'link', Date = 'date',
  Spacing = 'spacing', Radius = 'radius', Border = 'border', Shadow = 'shadow',
  Typography = 'typography', Transform = 'transform', Effects = 'effects', Layout = 'layout',
  Object = 'object', Array = 'array', Slot = 'slot', Slots = 'slots',
  /** Framer source values. The compatibility adapter lowers them before persistence. */
  SegmentedEnum = 'segmented-enum', ResponsiveImage = 'responsive-image', ComponentInstance = 'component-instance',
  Font = 'font', Transition = 'transition', BoxShadow = 'box-shadow',
  EventHandler = 'event-handler',
}

export interface PropertyCondition {
  property: string;
  operator: 'equals' | 'not-equals' | 'includes' | 'not-includes' | 'greater-than' | 'less-than' | 'exists';
  value?: JSONValue;
}
export type ControlCondition = PropertyCondition
  | { and: ControlCondition[] }
  | { or: ControlCondition[] }
  | { not: ControlCondition };

export interface ControlBase {
  title?: string;
  description?: string;
  category?: ControlCategory;
  order?: number;
  responsive?: boolean;
  bindable?: boolean;
  hidden?: ControlCondition;
  disabled?: ControlCondition;
  required?: ControlCondition;
  defaultValue?: unknown;
}

export interface StringControl extends ControlBase { type: ControlType.String; defaultValue?: string; placeholder?: string; maxLength?: number; pattern?: string }
export interface TextControl extends ControlBase { type: ControlType.Text; defaultValue?: string; placeholder?: string; minRows?: number; maxRows?: number; maxLength?: number; format?: 'plain' | 'rich-text-future' }
export interface NumberControl extends ControlBase { type: ControlType.Number; defaultValue?: number; min?: number; max?: number; step?: number; unit?: string; display?: 'input' | 'slider' | 'stepper' | 'slider-input' }
export interface BooleanControl extends ControlBase { type: ControlType.Boolean; defaultValue?: boolean; enabledTitle?: string; disabledTitle?: string }
export interface EnumControl extends ControlBase { type: ControlType.Enum; options: JSONPrimitive[]; optionTitles?: string[]; optionIcons?: string[]; defaultValue?: JSONPrimitive; display?: 'select' | 'segmented' | 'radio' | 'icon-grid' }

export type CodayColor = { value: string; format: 'hex' | 'rgb' | 'rgba' | 'hsl' | 'token' | 'variable'; alpha?: number; tokenId?: string };
export interface ColorControl extends ControlBase { type: ControlType.Color; defaultValue?: CodayColor | string; allowAlpha?: boolean; allowTokens?: boolean; gradients?: 'future' }
export interface CodayImage { id: string; src: string; srcSet?: string; width?: number; height?: number; alt?: string; focalPoint?: { x: number; y: number } }
export interface ImageControl extends ControlBase { type: ControlType.Image; defaultValue?: CodayImage; acceptedMimeTypes?: string[]; maxBytes?: number }
export interface CodayFile { id: string; url: string; name: string; mimeType: string; size: number }
export interface FileControl extends ControlBase { type: ControlType.File; defaultValue?: CodayFile; extensions?: string[]; mimeTypes?: string[]; maxBytes?: number }
export interface CodayLink { type: 'url' | 'page' | 'section' | 'email' | 'phone' | 'file'; value: string; target?: '_self' | '_blank'; rel?: string }
export interface LinkControl extends ControlBase { type: ControlType.Link; defaultValue?: CodayLink; allowedTypes?: CodayLink['type'][] }
export interface DateControl extends ControlBase { type: ControlType.Date; defaultValue?: string; mode?: 'date' | 'datetime'; timezone?: string; min?: string; max?: string }

export interface CodaySpacing { top: number; right: number; bottom: number; left: number; unit: CSSUnit; linked: boolean }
export interface SpacingControl extends ControlBase { type: ControlType.Spacing; defaultValue?: CodaySpacing; units?: CSSUnit[]; presets?: Array<{ id: string; title: string; value: CodaySpacing }> }
export interface CodayRadius { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number; unit: CSSUnit; linked: boolean }
export interface RadiusControl extends ControlBase { type: ControlType.Radius; defaultValue?: CodayRadius; units?: CSSUnit[] }
export interface CodayBorderSide { width: number; style: 'none' | 'solid' | 'dashed' | 'dotted' | 'double'; color: CodayColor | string }
export interface CodayBorder { enabled: boolean; linked: boolean; top: CodayBorderSide; right: CodayBorderSide; bottom: CodayBorderSide; left: CodayBorderSide; tokenId?: string }
export interface BorderControl extends ControlBase { type: ControlType.Border; defaultValue?: CodayBorder; allowTokens?: boolean }
export interface CodayShadow { id: string; x: number; y: number; blur: number; spread: number; color: CodayColor | string; inset: boolean }
export interface ShadowControl extends ControlBase { type: ControlType.Shadow; defaultValue?: CodayShadow[]; maxCount?: number }
export interface CodayTypography { family?: string; tokenId?: string; weight?: number; size?: number; unit?: CSSUnit; lineHeight?: number; letterSpacing?: number; align?: 'left' | 'center' | 'right' | 'justify'; transform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'; decoration?: 'none' | 'underline' | 'line-through'; clamp?: { min: number; preferred: number; max: number } }
export interface TypographyControl extends ControlBase { type: ControlType.Typography; defaultValue?: CodayTypography; allowTokens?: boolean }
export interface CodayTransform { translateX: number; translateY: number; translateZ: number; rotateX: number; rotateY: number; rotateZ: number; scaleX: number; scaleY: number; scaleZ: number; skewX: number; skewY: number; origin: string; perspective: number }
export interface TransformControl extends ControlBase { type: ControlType.Transform; defaultValue?: Partial<CodayTransform> }
export interface CodayEffects { opacity: number; blur: number; backdropBlur: number; brightness: number; contrast: number; saturation: number; hueRotate: number; blendMode: string }
export interface EffectsControl extends ControlBase { type: ControlType.Effects; defaultValue?: Partial<CodayEffects> }

export interface CodayLayout {
  mode: 'stack' | 'grid' | 'free' | 'diagonal';
  direction?: 'horizontal' | 'vertical'; gap?: number; rowGap?: number; columnGap?: number;
  wrap?: boolean; align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';
  columns?: number; minColumnWidth?: number;
  diagonal?: { angle: number; itemOffset: number; direction: 'forward' | 'reverse'; origin: 'start' | 'center' | 'end'; alignment: 'start' | 'center' | 'end'; rotateItems: boolean };
}
export interface LayoutControl extends ControlBase { type: ControlType.Layout; defaultValue?: CodayLayout }

export interface ObjectControl extends ControlBase { type: ControlType.Object; controls: Record<string, ControlDefinition>; defaultValue?: JSONObject; collapsed?: boolean }
export interface ArrayControl extends ControlBase { type: ControlType.Array; control: ControlDefinition; defaultValue?: JSONValue[]; minCount?: number; maxCount?: number; itemTitleAdapter?: string; collapsedItems?: boolean }
export interface SlotControl extends ControlBase { type: ControlType.Slot; accepts?: string[]; required?: ControlCondition }
export interface SlotsControl extends ControlBase { type: ControlType.Slots; accepts?: string[]; minCount?: number; maxCount?: number }

export type ControlDefinition = StringControl | TextControl | NumberControl | BooleanControl | EnumControl |
  ColorControl | ImageControl | FileControl | LinkControl | DateControl | SpacingControl | RadiusControl |
  BorderControl | ShadowControl | TypographyControl | TransformControl | EffectsControl | LayoutControl |
  ObjectControl | ArrayControl | SlotControl | SlotsControl;

export type SerializableControlDefinition = ControlDefinition;
export interface ResponsiveValue<T> { base: T; overrides?: { [breakpointId: string]: Partial<T> | T | undefined } }
export interface ValidationIssue { path: string; code: string; message: string; severity: 'error' | 'warning' }
export interface ValidationResult { valid: boolean; issues: ValidationIssue[] }
export interface ControlAdapter<TValue = unknown, TRaw = unknown> {
  parse(raw: TRaw, definition: ControlDefinition): TValue;
  validate(value: TValue, definition: ControlDefinition, path?: string): ValidationResult;
  normalize(value: TValue, definition: ControlDefinition): TValue;
  serialize(value: TValue, definition: ControlDefinition): JSONValue;
  deserialize(value: JSONValue, definition: ControlDefinition): TValue;
}
