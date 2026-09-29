"use client";

import { memo, useCallback, useMemo } from "react";
import type { Layer } from "@/types";
import TypographyControls from "@/app/(builder)/kodety/html-editor/ycode-style/TypographyControls";
import EffectControls from "@/app/(builder)/kodety/html-editor/ycode-style/EffectControls";
import SizingControlsCore from "@/app/(builder)/kodety/html-editor/ycode-style/SizingControlsCore";
import BackgroundsControls from "@/app/(builder)/kodety/html-editor/ycode-style/BackgroundsControls";
import BorderControls from "@/app/(builder)/kodety/html-editor/ycode-style/BorderControls";
import LayoutControls from "@/app/(builder)/kodety/html-editor/ycode-style/LayoutControls";
import PositionControls from "@/app/(builder)/kodety/components/PositionControls";
import SelfLayoutControls from "@/app/(builder)/kodety/html-editor/ycode-style/SelfLayoutControls";
import SpacingControls from "@/app/(builder)/kodety/html-editor/ycode-style/SpacingControls";
import TransformControls from "@/app/(builder)/kodety/html-editor/ycode-style/TransformControls";
import TransitionControls from "@/app/(builder)/kodety/html-editor/ycode-style/TransitionControls";
import { HTML_BACKGROUND_KEY } from "@/app/(builder)/kodety/html-editor/ycode-style/html-css-compat";
import { normalizeCssColorValue } from "@/lib/html-editor/style-utils";
import {
  cssSizingValueToControl,
  sizingControlValueToCss,
} from "@/lib/html-editor/sizing-values";
import {
  cssEasingToControl,
  cssFontFamilyToControl,
  cssOriginToControl,
  cssPositionToControl,
  cssTransitionPropertyToControl,
  controlFontFamilyToCss,
  resolveAtomicHtmlGapChange,
  resolveHtmlBorderRadiusMode,
  resolveHtmlGapMode,
  resolveAtomicHtmlBorderRadiusChange,
  normalizeVisualCssValue,
  normalizeCssControlInput,
  releaseCenteredPositionAnchor,
  replaceCssFunctions,
  splitCssFunctions,
} from "@/lib/html-editor/visual-style-adapter";
import {
  parseMaskLayers,
  serializeMaskLayers,
} from "@/lib/html-editor/mask-utils";
import {
  readTextPaintValue,
  textPaintDeclarationChanges,
} from "@/lib/html-editor/text-gradient";
import type { MaskLayerDesign } from "@/types";

interface HtmlKodetyStyleControlsProps {
  tag: string;
  values: Record<string, string>;
  onChange: (property: string, value: string) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  onInteractionCancel?: () => void;
  /** Stable editor selection identity; prevents an optimistic draft leaking to the next layer. */
  scopeKey?: string;
  /** Live canvas parent layout, unavailable to the synthetic Kodety layer adapter. */
  parentHasGrid?: boolean;
  /** Computed display mode of the selected element's parent. */
  parentDisplay?: string;
  hideOverflow?: boolean;
  embedded?: boolean;
  shadowOnly?: boolean;
  /** Direct children use absolute positioning while the container acts as a free canvas. */
  freeLayout?: boolean;
  onFreeLayoutChange?: (enabled: boolean) => void;
  visibleDisplay?: string;
  onVisibilityChange?: (visible: boolean) => void;
  /** Declarations authored in the active inline/rule scope, without computed fallbacks. */
  authoredValues?: Record<string, string>;
}

const propertyMap = {
  layout: {
    display: "display",
    visibility: "visibility",
    flexDirection: "flex-direction",
    alignItems: "align-items",
    alignSelf: "align-self",
    justifyContent: "justify-content",
    flexWrap: "flex-wrap",
    gap: "gap",
    columnGap: "column-gap",
    rowGap: "row-gap",
    gridTemplateColumns: "grid-template-columns",
    gridTemplateRows: "grid-template-rows",
  },
  spacing: {
    marginTop: "margin-top",
    marginRight: "margin-right",
    marginBottom: "margin-bottom",
    marginLeft: "margin-left",
    paddingTop: "padding-top",
    paddingRight: "padding-right",
    paddingBottom: "padding-bottom",
    paddingLeft: "padding-left",
  },
  typography: {
    fontFamily: "font-family",
    fontWeight: "font-weight",
    fontStyle: "font-style",
    fontSize: "font-size",
    textAlign: "text-align",
    textWrap: "text-wrap",
    letterSpacing: "letter-spacing",
    lineHeight: "line-height",
    color: "color",
    textTransform: "text-transform",
    textDecoration: "text-decoration",
    textDecorationColor: "text-decoration-color",
    textDecorationThickness: "text-decoration-thickness",
    underlineOffset: "text-underline-offset",
    lineClamp: "-webkit-line-clamp",
  },
  effects: {
    opacity: "opacity",
    boxShadow: "box-shadow",
    blur: "filter",
    backdropBlur: "backdrop-filter",
    brightness: "filter",
    contrast: "filter",
    grayscale: "filter",
    hueRotate: "filter",
    invert: "filter",
    saturate: "filter",
    sepia: "filter",
  },
  sizing: {
    width: "width",
    height: "height",
    minWidth: "min-width",
    minHeight: "min-height",
    maxWidth: "max-width",
    maxHeight: "max-height",
    overflow: "overflow",
    aspectRatio: "aspect-ratio",
    objectFit: "object-fit",
    objectPosition: "object-position",
    gridColumnSpan: "grid-column",
    gridRowSpan: "grid-row",
  },
  backgrounds: {
    backgroundColor: "background-color",
    backgroundImage: "background-image",
    backgroundSize: "background-size",
    backgroundPosition: "background-position",
    backgroundRepeat: "background-repeat",
    backgroundClip: "background-clip",
  },
  borders: {
    borderRadius: "border-radius",
    borderTopLeftRadius: "border-top-left-radius",
    borderTopRightRadius: "border-top-right-radius",
    borderBottomRightRadius: "border-bottom-right-radius",
    borderBottomLeftRadius: "border-bottom-left-radius",
    borderWidth: "border-width",
    borderTopWidth: "border-top-width",
    borderRightWidth: "border-right-width",
    borderBottomWidth: "border-bottom-width",
    borderLeftWidth: "border-left-width",
    borderStyle: "border-style",
    borderColor: "border-color",
    outlineWidth: "outline-width",
    outlineStyle: "outline-style",
    outlineColor: "outline-color",
    outlineOffset: "outline-offset",
  },
  positioning: {
    position: "position",
    top: "top",
    right: "right",
    bottom: "bottom",
    left: "left",
    zIndex: "z-index",
  },
  transforms: {
    scale: "scale",
    rotate: "rotate",
    rotateX: "transform",
    rotateY: "transform",
    rotateZ: "transform",
    depth: "transform",
    translateX: "translate",
    translateY: "translate",
    skewX: "transform",
    skewY: "transform",
    transformOrigin: "transform-origin",
    transformStyle: "transform-style",
    backfaceVisibility: "backface-visibility",
  },
  transitions: {
    transitionProperty: "transition-property",
    duration: "transition-duration",
    easing: "transition-timing-function",
    delay: "transition-delay",
  },
} as const;

const weightToCss: Record<string, string> = {
  thin: "100",
  extralight: "200",
  light: "300",
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
  black: "900",
};

const EFFECT_FILTER_FUNCTIONS = {
  blur: { name: "blur", unit: "px" },
  brightness: { name: "brightness", unit: "%" },
  contrast: { name: "contrast", unit: "%" },
  grayscale: { name: "grayscale", unit: "%" },
  hueRotate: { name: "hue-rotate", unit: "deg" },
  invert: { name: "invert", unit: "%" },
  saturate: { name: "saturate", unit: "%" },
  sepia: { name: "sepia", unit: "%" },
} as const;

type EffectFilterProperty = keyof typeof EFFECT_FILTER_FUNCTIONS;

function readCssFunctionValue(source: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}\\(\\s*([^)]*?)\\s*\\)`, "i"))?.[1] || "";
}

function readPercentFilterValue(source: string, name: string) {
  const raw = readCssFunctionValue(source, name);
  if (!raw) return "";
  if (raw.endsWith("%")) return raw;
  const numeric = Number.parseFloat(raw);
  return Number.isFinite(numeric) ? `${numeric * 100}%` : raw;
}

function toCssValue(category: string, property: string, value: string) {
  if (!value) return "";
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  value = normalizeVisualCssValue(category, property, value);
  if (
    [
      "backgroundColor",
      "color",
      "borderColor",
      "outlineColor",
      "textDecorationColor",
    ].includes(property) ||
    value.includes("gradient(")
  )
    value = normalizeCssColorValue(value);
  if (category === "layout" && property === "display" && value === "hidden")
    return "none";
  if (category === "layout" && property === "justifyContent") {
    return (
      (
        {
          start: "flex-start",
          end: "flex-end",
          between: "space-between",
          around: "space-around",
          evenly: "space-evenly",
        } as Record<string, string>
      )[value] || value
    );
  }
  if (category === "layout" && ["alignItems", "alignSelf"].includes(property)) {
    return (
      ({ start: "flex-start", end: "flex-end" } as Record<string, string>)[
        value
      ] || value
    );
  }
  if (category === "effects" && property === "opacity") {
    return String(Math.max(0, Math.min(100, Number(value))) / 100);
  }
  if (category === "effects" && property === "boxShadow") {
    return value.replaceAll(",_", ", ").replaceAll("_", " ");
  }
  if (category === "effects" && property === "backdropBlur") {
    if (value === "0" || value === "0px") return "";
    return `blur(${/^-?\d+(\.\d+)?$/.test(value) ? `${value}px` : value})`;
  }
  if (category === "effects" && property in EFFECT_FILTER_FUNCTIONS) {
    const definition = EFFECT_FILTER_FUNCTIONS[property as EffectFilterProperty];
    if (property === "blur" && (value === "0" || value === "0px")) return "";
    const cssValue = /^-?\d+(\.\d+)?$/.test(value)
      ? `${value}${definition.unit}`
      : value;
    return `${definition.name}(${cssValue})`;
  }
  if (category === "typography" && property === "fontWeight")
    return weightToCss[value] || value;
  if (category === "typography" && property === "fontFamily")
    return controlFontFamilyToCss(value);
  if (
    category === "typography" &&
    property === "letterSpacing" &&
    /^-?\d+(\.\d+)?$/.test(value)
  ) {
    return value === "0" ? "0" : `${value}em`;
  }
  if (category === "sizing") {
    // Normalize the control value before writing browser-native CSS.
    value = sizingControlValueToCss(property, value);
    if (
      /^-?\d+(\.\d+)?$/.test(value) &&
      !["aspectRatio", "gridColumnSpan", "gridRowSpan"].includes(property)
    ) {
      return value === "0" ? "0" : `${value}px`;
    }
  }
  if (
    /^-?\d+(\.\d+)?$/.test(value) &&
    (category === "spacing" ||
      category === "layout" ||
      category === "borders" ||
      (category === "positioning" && property !== "zIndex") ||
      ["fontSize", "textDecorationThickness", "underlineOffset"].includes(
        property,
      ))
  )
    return value === "0" ? "0" : `${value}px`;
  if (category === "sizing" && property === "aspectRatio")
    return value.replace("/", " / ");
  if (
    category === "sizing" &&
    ["gridColumnSpan", "gridRowSpan"].includes(property)
  )
    return value;
  if (
    category === "transitions" &&
    ["duration", "delay"].includes(property) &&
    /^\d+(\.\d+)?$/.test(value)
  )
    return `${value}ms`;
  if (
    category === "transforms" &&
    property === "rotate" &&
    /^-?\d+(\.\d+)?$/.test(value)
  )
    return `${value}deg`;
  if (
    category === "transforms" &&
    ["translateX", "translateY"].includes(property)
  )
    return value;
  return value;
}

function shadowToKodety(value: string) {
  return value
    .replace(/,\s+(?=(?:[^()]|\([^()]*\))*$)/g, ",_")
    .replaceAll(" ", "_");
}

function splitCssValueTokens(value: string) {
  const tokens: string[] = [];
  let token = "";
  let depth = 0;
  for (const character of value.trim()) {
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(character) && depth === 0) {
      if (token) tokens.push(token);
      token = "";
    } else {
      token += character;
    }
  }
  if (token) tokens.push(token);
  return tokens;
}

function authoredInsetSides(values?: Record<string, string>) {
  if (!values) return undefined;
  const sides = ["top", "right", "bottom", "left"] as const;
  const shorthand = splitCssValueTokens(
    (values.inset || "").replace(/\s*!important\s*$/i, ""),
  );
  const expanded =
    shorthand.length === 1
      ? [shorthand[0], shorthand[0], shorthand[0], shorthand[0]]
      : shorthand.length === 2
        ? [shorthand[0], shorthand[1], shorthand[0], shorthand[1]]
        : shorthand.length === 3
          ? [shorthand[0], shorthand[1], shorthand[2], shorthand[1]]
          : shorthand.slice(0, 4);
  return sides.filter((side, index) => {
    const rawValue = Object.hasOwn(values, side)
      ? values[side]
      : expanded[index];
    const normalized = String(rawValue || "")
      .replace(/\s*!important\s*$/i, "")
      .trim()
      .toLowerCase();
    return Boolean(normalized && normalized !== "auto");
  });
}

function transformSkewToControls(value: string) {
  const combined = value.match(
    /(?:^|\s)skew\(\s*([^,)]+)(?:,\s*([^\)]+))?\s*\)/,
  );
  const x =
    value.match(/(?:^|\s)skewX\(\s*([^\)]+)\s*\)/)?.[1] || combined?.[1] || "";
  const y =
    value.match(/(?:^|\s)skewY\(\s*([^\)]+)\s*\)/)?.[1] || combined?.[2] || "";
  return {
    skewX: x.trim().replace(/deg$/i, ""),
    skewY: y.trim().replace(/deg$/i, ""),
  };
}

function transformFunctionValue(value: string, functionName: string) {
  const target = functionName.toLowerCase();
  const part = splitCssFunctions(value).find(candidate => (
    candidate.match(/^([\w-]+)\s*\(/)?.[1]?.toLowerCase() === target
  ));
  return part?.match(/^[\w-]+\s*\(\s*([^\)]*?)\s*\)$/)?.[1]?.trim() || "";
}

function transform3DToControls(value: string) {
  const angle = (name: string) => transformFunctionValue(value, name).replace(/deg$/i, "");
  return {
    rotateX: angle("rotateX"),
    rotateY: angle("rotateY"),
    rotateZ: angle("rotateZ"),
    depth: transformFunctionValue(value, "perspective").replace(/px$/i, ""),
  };
}

function createLayer(
  tag: string,
  values: Record<string, string>,
  scopeKey = "",
  realtimePreview = false,
  authoredValues?: Record<string, string>,
): Layer {
  const normalizedTag = tag.toLowerCase();
  const layerName = /^h[1-6]$/.test(normalizedTag)
    ? "heading"
    : ["p", "span", "strong", "em", "small", "label", "li", "blockquote"].includes(
          normalizedTag,
        )
      ? "text"
      : normalizedTag === "img"
        ? "image"
        : normalizedTag === "svg"
          ? "icon"
          : normalizedTag || "div";
  const opacity = Math.round(
    Math.max(0, Math.min(1, Number.parseFloat(values.opacity || "1"))) * 100,
  );
  const transform3D = transform3DToControls(values.transform || "");
  const toSizingControlValue = cssSizingValueToControl;
  const authoredAspectRatio = values["aspect-ratio"]?.trim() || "";
  // Replaced media exposes an intrinsic computed ratio such as
  // `auto 1820 / 966`. It is browser metadata, not an authored declaration,
  // and must not become an editable visual property by itself.
  const aspectRatioValue =
    !authoredAspectRatio ||
    authoredAspectRatio === "auto" ||
    authoredAspectRatio.startsWith("auto ")
      ? ""
      : `[${authoredAspectRatio.replaceAll(" ", "")}]`;
  const skew = transformSkewToControls(values.transform || "");
  const authoredBackgroundImage = values["background-image"] || "";
  const backgroundIsGradient = authoredBackgroundImage.includes("gradient(");
  const maxWidthValue = toSizingControlValue(values["max-width"] || "");
  const maxHeightValue = toSizingControlValue(values["max-height"] || "");
  const minWidthValue = toSizingControlValue(values["min-width"] || "");
  const minHeightValue = toSizingControlValue(values["min-height"] || "");
  const optionalMinimum = (value: string) => {
    const normalized = value.trim().toLowerCase();
    return normalized === "auto" ||
      /^0(?:\.0+)?(?:px|rem|em|%|vw|vh|dvw|dvh|svw|svh|lvw|lvh)?$/.test(
        normalized,
      )
      ? ""
      : value;
  };
  const optionalMaximum = (value: string) => {
    const normalized = value.trim().toLowerCase();
    return normalized === "none" || normalized === "auto" ? "" : value;
  };
  return {
    id: `html-editor-selection:${realtimePreview ? "realtime-preview:" : ""}${scopeKey}`,
    name: layerName,
    classes: "",
    design: {
      layout: {
        isActive: true,
        gapMode: resolveHtmlGapMode(authoredValues, values),
        display: values.display === "none" ? "hidden" : values.display || "",
        visibility: values.visibility || "visible",
        flexDirection: values["flex-direction"] || "row",
        alignItems:
          (
            {
              "flex-start": "start",
              "flex-end": "end",
              normal: "start",
            } as Record<string, string>
          )[values["align-items"]] ||
          values["align-items"] ||
          "start",
        alignSelf:
          (
            {
              "flex-start": "start",
              "flex-end": "end",
              normal: "auto",
            } as Record<string, string>
          )[values["align-self"]] ||
          values["align-self"] ||
          "auto",
        justifyContent:
          (
            {
              "flex-start": "start",
              "flex-end": "end",
              "space-between": "between",
              "space-around": "around",
              "space-evenly": "evenly",
              normal: "start",
            } as Record<string, string>
          )[values["justify-content"]] ||
          values["justify-content"] ||
          "start",
        flexWrap: values["flex-wrap"] || "nowrap",
        gap: values.gap === "normal" ? "" : values.gap || "",
        columnGap:
          values["column-gap"] === "normal" ? "" : values["column-gap"] || "",
        rowGap: values["row-gap"] === "normal" ? "" : values["row-gap"] || "",
        gridTemplateColumns: values["grid-template-columns"] || "",
        gridTemplateRows: values["grid-template-rows"] || "",
      },
      spacing: {
        isActive: true,
        marginTop: values["margin-top"] || "",
        marginRight: values["margin-right"] || "",
        marginBottom: values["margin-bottom"] || "",
        marginLeft: values["margin-left"] || "",
        paddingTop: values["padding-top"] || "",
        paddingRight: values["padding-right"] || "",
        paddingBottom: values["padding-bottom"] || "",
        paddingLeft: values["padding-left"] || "",
      },
      typography: {
        isActive: true,
        fontFamily: cssFontFamilyToControl(values["font-family"] || "inherit"),
        fontWeight: values["font-weight"] || "400",
        fontStyle: values["font-style"] || "normal",
        fontSize: values["font-size"] || "",
        textAlign: values["text-align"] || "left",
        // Only an authored declaration counts: the computed default is `wrap`,
        // and treating it as set would show the control on every text layer.
        textWrap:
          values["text-wrap"] === "wrap" ? "" : values["text-wrap"] || "",
        letterSpacing: values["letter-spacing"] || "",
        lineHeight: values["line-height"] || "",
        color: readTextPaintValue(values),
        textTransform: values["text-transform"] || "none",
        textDecoration: values["text-decoration"] || "none",
        textDecorationColor: values["text-decoration-color"] || "",
        textDecorationThickness: values["text-decoration-thickness"] || "",
        underlineOffset: values["text-underline-offset"] || "",
        lineClamp: values["-webkit-line-clamp"] || "",
      },
      effects: {
        isActive: true,
        opacity: String(opacity),
        boxShadow: shadowToKodety(values["box-shadow"] || ""),
        blur: readCssFunctionValue(values.filter || "", "blur"),
        backdropBlur:
          readCssFunctionValue(values["backdrop-filter"] || "", "blur"),
        brightness: readPercentFilterValue(values.filter || "", "brightness"),
        contrast: readPercentFilterValue(values.filter || "", "contrast"),
        grayscale: readPercentFilterValue(values.filter || "", "grayscale"),
        hueRotate: readCssFunctionValue(values.filter || "", "hue-rotate"),
        invert: readPercentFilterValue(values.filter || "", "invert"),
        saturate: readPercentFilterValue(values.filter || "", "saturate"),
        sepia: readPercentFilterValue(values.filter || "", "sepia"),
        masks: parseMaskLayers(values),
      },
      sizing: {
        isActive: true,
        width: toSizingControlValue(values.width || ""),
        height: toSizingControlValue(values.height || ""),
        minWidth: optionalMinimum(minWidthValue),
        minHeight: optionalMinimum(minHeightValue),
        maxWidth: optionalMaximum(maxWidthValue),
        maxHeight: optionalMaximum(maxHeightValue),
        overflow:
          values["text-overflow"] === "ellipsis" && values.overflow === "hidden"
            ? "ellipsis"
            : values.overflow || "visible",
        aspectRatio: aspectRatioValue,
        objectFit: values["object-fit"] || "",
        objectPosition: cssPositionToControl(values["object-position"] || ""),
        gridColumnSpan:
          values["grid-column"]?.trim() === "1 / -1"
            ? "full"
            : values["grid-column"]?.match(/span\s+(\d+)/)?.[1] || "",
        gridRowSpan:
          values["grid-row"]?.trim() === "1 / -1"
            ? "full"
            : values["grid-row"]?.match(/span\s+(\d+)/)?.[1] || "",
      },
      backgrounds: {
        isActive: true,
        backgroundColor: values["background-color"] || "",
        backgroundImage: authoredBackgroundImage ? HTML_BACKGROUND_KEY : "",
        bgImageVars:
          authoredBackgroundImage && !backgroundIsGradient
            ? { [HTML_BACKGROUND_KEY]: authoredBackgroundImage }
            : undefined,
        bgGradientVars:
          authoredBackgroundImage && backgroundIsGradient
            ? { [HTML_BACKGROUND_KEY]: authoredBackgroundImage }
            : undefined,
        backgroundSize: values["background-size"] || "cover",
        backgroundPosition: cssPositionToControl(
          values["background-position"] || "center",
        ),
        backgroundRepeat:
          (
            { round: "repeat-round", space: "repeat-space" } as Record<
              string,
              string
            >
          )[values["background-repeat"]] ||
          values["background-repeat"] ||
          "no-repeat",
        backgroundClip: values["background-clip"] || "",
      },
      borders: {
        isActive: true,
        borderRadiusMode: resolveHtmlBorderRadiusMode(authoredValues, values),
        borderRadius: values["border-radius"] || "",
        borderTopLeftRadius: values["border-top-left-radius"] || "",
        borderTopRightRadius: values["border-top-right-radius"] || "",
        borderBottomRightRadius: values["border-bottom-right-radius"] || "",
        borderBottomLeftRadius: values["border-bottom-left-radius"] || "",
        borderWidth: values["border-width"] || "",
        borderTopWidth: values["border-top-width"] || "",
        borderRightWidth: values["border-right-width"] || "",
        borderBottomWidth: values["border-bottom-width"] || "",
        borderLeftWidth: values["border-left-width"] || "",
        borderStyle: values["border-style"] || "solid",
        borderColor: values["border-color"] || "",
        outlineWidth: values["outline-width"] || "",
        outlineStyle: values["outline-style"] || "none",
        outlineColor: values["outline-color"] || "",
        outlineOffset: values["outline-offset"] || "",
      },
      positioning: {
        isActive: true,
        position: values.position || "static",
        top: values.top || "",
        right: values.right || "",
        bottom: values.bottom || "",
        left: values.left || "",
        zIndex: values["z-index"] || "",
      },
      transforms: {
        isActive: true,
        scale: values.scale || "",
        rotate: values.rotate === "none" ? "" : values.rotate || "",
        rotateX: transform3D.rotateX,
        rotateY: transform3D.rotateY,
        rotateZ: transform3D.rotateZ,
        depth: transform3D.depth,
        translateX: values.translate?.split(" ")[0] || "",
        translateY: values.translate?.split(" ")[1] || "",
        skewX: skew.skewX,
        skewY: skew.skewY,
        transformOrigin: cssOriginToControl(values["transform-origin"] || ""),
        transformStyle: values["transform-style"] || "",
        backfaceVisibility: values["backface-visibility"] || "",
      },
      transitions: {
        isActive: true,
        transitionProperty: cssTransitionPropertyToControl(
          values["transition-property"] || "",
        ),
        duration: values["transition-duration"] || "",
        easing: cssEasingToControl(values["transition-timing-function"] || ""),
        delay: values["transition-delay"] || "",
      },
    },
  };
}

function useHtmlKodetyLayer({
  tag,
  values,
  onChange,
  onInteractionStart,
  scopeKey,
  authoredValues,
}: HtmlKodetyStyleControlsProps) {
  const realtimePreview = Boolean(onInteractionStart);
  const layer = useMemo(
    () => createLayer(tag, values, scopeKey, realtimePreview, authoredValues),
    [authoredValues, realtimePreview, scopeKey, tag, values],
  );
  const onLayerUpdate = useCallback(
    (_layerId: string, updates: Partial<Layer>) => {
      const nextDesign = updates.design;
      if (!nextDesign) return;
      (Object.keys(propertyMap) as Array<keyof typeof propertyMap>).forEach(
        (category) => {
          const nextCategory = nextDesign[category] as
            Record<string, unknown> | undefined;
          const currentCategory = layer.design?.[category] as
            Record<string, unknown> | undefined;
          if (!nextCategory) return;
          const atomicBorderRadiusChange =
            category === "borders"
              ? resolveAtomicHtmlBorderRadiusChange(nextCategory, currentCategory)
              : null;
          const atomicGapChange =
            category === "layout"
              ? resolveAtomicHtmlGapChange(nextCategory, currentCategory)
              : null;
          if (atomicBorderRadiusChange) {
            onChange(
              atomicBorderRadiusChange.property,
              atomicBorderRadiusChange.values
                .map(value => toCssValue(category, "borderRadius", value))
                .join(" "),
            );
          }
          if (atomicGapChange) {
            onChange(
              atomicGapChange.property,
              atomicGapChange.values
                .map((value, index) => toCssValue(
                  category,
                  atomicGapChange.values.length === 1
                    ? "gap"
                    : index === 0
                      ? "rowGap"
                      : "columnGap",
                  value,
                ))
                .join(" "),
            );
          }
          if (category === "effects") {
            if (nextCategory.masks !== currentCategory?.masks) {
              const serializedMasks = serializeMaskLayers(
                (nextCategory.masks as MaskLayerDesign[] | undefined) || [],
              );
              const currentSerializedMasks = serializeMaskLayers(
                (currentCategory?.masks as MaskLayerDesign[] | undefined) || [],
              );
              // Legacy WebKit declarations must precede the standard ones so
              // modern engines use the standards-based composite semantics.
              Object.entries(serializedMasks).forEach(([property, value]) => {
                if (currentSerializedMasks[property] !== value) onChange(property, value);
              });
            }
            let nextFilter = values.filter || "";
            let filterChanged = false;
            for (const [filterProperty, definition] of Object.entries(EFFECT_FILTER_FUNCTIONS)) {
              if (nextCategory[filterProperty] === currentCategory?.[filterProperty]) continue;
              const nextFunction = toCssValue(
                "effects",
                filterProperty,
                String(nextCategory[filterProperty] || ""),
              );
              nextFilter = replaceCssFunctions(nextFilter, definition.name, nextFunction);
              filterChanged = true;
            }
            if (filterChanged) onChange("filter", nextFilter);
            if (nextCategory.backdropBlur !== currentCategory?.backdropBlur) {
              const nextBlur = toCssValue(
                "effects",
                "backdropBlur",
                String(nextCategory.backdropBlur || ""),
              );
              onChange(
                "backdrop-filter",
                replaceCssFunctions(
                  values["backdrop-filter"] || "",
                  "blur",
                  nextBlur,
                ),
              );
            }
          }
          if (category === "backgrounds") {
            const nextImageVars = nextCategory.bgImageVars as
              | Record<string, string>
              | undefined;
            const nextGradientVars = nextCategory.bgGradientVars as
              | Record<string, string>
              | undefined;
            const currentImageVars = currentCategory?.bgImageVars as
              | Record<string, string>
              | undefined;
            const currentGradientVars = currentCategory?.bgGradientVars as
              | Record<string, string>
              | undefined;
            const nextBackgroundImage =
              nextGradientVars?.[HTML_BACKGROUND_KEY] ||
              nextImageVars?.[HTML_BACKGROUND_KEY] ||
              "";
            const currentBackgroundImage =
              currentGradientVars?.[HTML_BACKGROUND_KEY] ||
              currentImageVars?.[HTML_BACKGROUND_KEY] ||
              "";
            if (
              nextBackgroundImage !== currentBackgroundImage ||
              nextCategory.backgroundImage !== currentCategory?.backgroundImage
            ) {
              onChange("background-image", nextBackgroundImage);
            }
          }
          if (category === "transforms") {
            const transform3DChanged = ["rotateX", "rotateY", "rotateZ", "depth"].some(
              property => nextCategory[property] !== currentCategory?.[property],
            );
            if (transform3DChanged) {
              const managedNames = new Set(["perspective", "rotatex", "rotatey", "rotatez"]);
              const preserved = splitCssFunctions(values.transform || "").filter(part => {
                const name = part.match(/^([\w-]+)\s*\(/)?.[1]?.toLowerCase();
                return !name || !managedNames.has(name);
              });
              const withAngle = (value: string) => (
                /^-?(?:\d+\.?\d*|\.\d+)$/.test(value) ? `${value}deg` : value
              );
              const withLength = (value: string) => (
                /^-?(?:\d+\.?\d*|\.\d+)$/.test(value) && value !== "0" ? `${value}px` : value
              );
              const rawDepth = String(nextCategory.depth || "").trim();
              const perspective = rawDepth && !/^0(?:\.0+)?(?:[a-z%]+)?$/i.test(rawDepth)
                ? `perspective(${withLength(rawDepth)})`
                : "";
              const rotations = (["rotateX", "rotateY", "rotateZ"] as const)
                .map(property => {
                  const raw = String(nextCategory[property] || "").trim();
                  return raw ? `${property}(${withAngle(raw)})` : "";
                })
                .filter(Boolean);
              onChange("transform", [perspective, ...preserved, ...rotations].filter(Boolean).join(" "));
            }
            const translateChanged = ["translateX", "translateY"].some(
              (property) =>
                nextCategory[property] !== currentCategory?.[property],
            );
            if (translateChanged) {
              const x = String(nextCategory.translateX || "0");
              const y = String(nextCategory.translateY || "0");
              const withUnit = (value: string) =>
                /^-?\d+(\.\d+)?$/.test(value) && value !== "0"
                  ? `${value}px`
                  : value;
              onChange("translate", `${withUnit(x)} ${withUnit(y)}`);
            }
            const skewChanged = ["skewX", "skewY"].some(
              (property) =>
                nextCategory[property] !== currentCategory?.[property],
            );
            if (skewChanged) {
              const rawX = String(nextCategory.skewX || "");
              const rawY = String(nextCategory.skewY || "");
              const x = rawX || "0";
              const y = rawY || "0";
              const withUnit = (value: string) =>
                /^-?\d+(\.\d+)?$/.test(value) ? `${value}deg` : value;
              const skew =
                rawX || rawY ? `skew(${withUnit(x)}, ${withUnit(y)})` : "";
              onChange(
                "transform",
                replaceCssFunctions(
                  values.transform || "",
                  ["skew", "skewX", "skewY"],
                  skew,
                ),
              );
            }
          }
          if (category === "positioning") {
            const nextPosition = String(
              nextCategory.position || currentCategory?.position || "",
            );
            const hasExplicitInset = (
              property: "top" | "right" | "bottom" | "left",
            ) => {
              const value = nextCategory[property];
              return (
                value !== undefined &&
                value !== null &&
                String(value).trim() !== "" &&
                String(value).trim().toLowerCase() !== "auto"
              );
            };
            const becameAbsolute =
              nextCategory.position !== currentCategory?.position &&
              nextPosition === "absolute";
            const horizontal =
              nextPosition === "absolute" &&
              ((nextCategory.left !== currentCategory?.left &&
                hasExplicitInset("left")) ||
                (nextCategory.right !== currentCategory?.right &&
                  hasExplicitInset("right")) ||
                (becameAbsolute &&
                  (hasExplicitInset("left") || hasExplicitInset("right"))));
            const vertical =
              nextPosition === "absolute" &&
              ((nextCategory.top !== currentCategory?.top &&
                hasExplicitInset("top")) ||
                (nextCategory.bottom !== currentCategory?.bottom &&
                  hasExplicitInset("bottom")) ||
                (becameAbsolute &&
                  (hasExplicitInset("top") || hasExplicitInset("bottom"))));
            if (horizontal || vertical) {
              const released = releaseCenteredPositionAnchor(
                values.translate || "",
                values.transform || "",
                { horizontal, vertical },
              );
              if (released.translateChanged)
                onChange("translate", released.translate);
              if (released.transformChanged)
                onChange("transform", released.transform);
            }
          }
          Object.entries(propertyMap[category]).forEach(
            ([property, cssProperty]) => {
              if (
                atomicBorderRadiusChange &&
                atomicBorderRadiusChange.consumedDesignProperties.includes(
                  property as (typeof atomicBorderRadiusChange.consumedDesignProperties)[number],
                )
              )
                return;
              if (
                atomicGapChange &&
                atomicGapChange.consumedDesignProperties.includes(
                  property as (typeof atomicGapChange.consumedDesignProperties)[number],
                )
              )
                return;
              if (
                category === "transforms" &&
                ["translateX", "translateY", "skewX", "skewY", "rotateX", "rotateY", "rotateZ", "depth"].includes(
                  property,
                )
              )
                return;
              if (
                category === "effects" &&
                ["blur", "backdropBlur", "brightness", "contrast", "grayscale", "hueRotate", "invert", "saturate", "sepia"].includes(property)
              )
                return;
              if (category === "backgrounds" && property === "backgroundImage")
                return;
              if (nextCategory[property] === currentCategory?.[property])
                return;
              if (category === "sizing" && property === "overflow") {
                const value = String(nextCategory[property] || "");
                if (value === "ellipsis") {
                  onChange("overflow", "hidden");
                  onChange("text-overflow", "ellipsis");
                } else {
                  if (currentCategory?.overflow === "ellipsis")
                    onChange("text-overflow", "");
                  onChange("overflow", toCssValue(category, property, value));
                }
                return;
              }
              if (category === "typography" && property === "color") {
                textPaintDeclarationChanges(
                  toCssValue(category, property, String(nextCategory[property] || "")),
                  values,
                ).forEach(change => onChange(change.property, change.value));
                return;
              }
              onChange(
                cssProperty,
                toCssValue(
                  category,
                  property,
                  String(nextCategory[property] || ""),
                ),
              );
            },
          );
        },
      );
    },
    [layer, onChange, values],
  );

  return { layer, onLayerUpdate };
}

export function HtmlKodetyLayoutControls(props: HtmlKodetyStyleControlsProps) {
  const adapter = useHtmlKodetyLayer(props);
  return (
    <LayoutControls
      {...adapter}
      freeLayout={props.freeLayout}
      onFreeLayoutChange={props.onFreeLayoutChange}
      visibleDisplay={props.visibleDisplay}
      onVisibilityChange={props.onVisibilityChange}
    />
  );
}

export function HtmlKodetySelfLayoutControls(
  props: HtmlKodetyStyleControlsProps,
) {
  const adapter = useHtmlKodetyLayer(props);
  const parentLayer = useMemo(
    () =>
      createLayer(
        "div",
        { display: props.parentDisplay || "" },
        `${props.scopeKey || "html-editor-selection"}:parent`,
      ),
    [props.parentDisplay, props.scopeKey],
  );
  return <SelfLayoutControls {...adapter} parentLayer={parentLayer} />;
}

export const HtmlKodetySpacingControls = memo(
  function HtmlKodetySpacingControls(props: HtmlKodetyStyleControlsProps) {
    const adapter = useHtmlKodetyLayer(props);
    return <SpacingControls {...adapter} />;
  },
);

export function HtmlKodetyTypographyControls(
  props: HtmlKodetyStyleControlsProps,
) {
  const adapter = useHtmlKodetyLayer(props);
  return <TypographyControls {...adapter} />;
}

export function HtmlKodetyEffectControls(props: HtmlKodetyStyleControlsProps) {
  const adapter = useHtmlKodetyLayer(props);
  return <EffectControls {...adapter} />;
}

export function HtmlKodetySizingControls(props: HtmlKodetyStyleControlsProps) {
  const adapter = useHtmlKodetyLayer(props);
  return (
    <SizingControlsCore
      {...adapter}
      parentHasGrid={props.parentHasGrid ?? false}
    />
  );
}

export function HtmlKodetyBackgroundsControls(
  props: HtmlKodetyStyleControlsProps,
) {
  const adapter = useHtmlKodetyLayer(props);
  return <BackgroundsControls {...adapter} />;
}

export function HtmlKodetyBorderControls(props: HtmlKodetyStyleControlsProps) {
  const adapter = useHtmlKodetyLayer(props);
  return <BorderControls {...adapter} />;
}

export function HtmlKodetyPositionControls(
  props: HtmlKodetyStyleControlsProps,
) {
  const adapter = useHtmlKodetyLayer(props);
  return (
    <PositionControls
      {...adapter}
      activeInsetSides={authoredInsetSides(props.authoredValues)}
      normalizeInput={normalizeCssControlInput}
    />
  );
}

export function HtmlKodetyTransformControls(
  props: HtmlKodetyStyleControlsProps,
) {
  const adapter = useHtmlKodetyLayer(props);
  return <TransformControls {...adapter} />;
}

export function HtmlKodetyTransitionControls(
  props: HtmlKodetyStyleControlsProps,
) {
  const adapter = useHtmlKodetyLayer(props);
  return <TransitionControls {...adapter} />;
}
