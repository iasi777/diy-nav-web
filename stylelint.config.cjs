module.exports = {
  extends: [
    'stylelint-config-standard-scss',
    'stylelint-config-standard-vue'
  ],
  customSyntax: 'postcss-html',
  overrides: [
    {
      files: ['**/*.scss'],
      customSyntax: 'postcss-scss'
    }
  ],
  rules: {
    'at-rule-no-unknown': null,
    'media-feature-name-value-no-unknown': null,
    'color-function-notation': 'legacy',
    'color-function-alias-notation': null,
    'alpha-value-notation': 'number',
    'selector-class-pattern': null,
    'declaration-property-value-no-unknown': null,
    'shorthand-property-no-redundant-values': null,
    'selector-not-notation': null,
    'selector-pseudo-class-no-unknown': null,
    'no-descending-specificity': null,
    'rule-empty-line-before': null,
    'value-keyword-case': null,
    'declaration-empty-line-before': null,
    'media-feature-range-notation': null,
    'at-rule-empty-line-before': null,
    'scss/no-global-function-names': null,
    'selector-no-vendor-prefix': null,
    'no-invalid-position-declaration': null,
    'comment-empty-line-before': null,

    // 设计令牌规范：禁止硬编码颜色值（允许 transparent, inherit, currentColor 等关键字）
    'color-no-hex': [true, {
      severity: 'warning',
      message: '请使用设计令牌变量代替硬编码颜色值 (如 $color-primary 或 var(--color-primary))'
    }],

    // 禁止在特定属性中使用硬编码像素值
    'declaration-property-value-disallowed-list': [
      {
        // 禁止 border-radius 使用硬编码像素值（允许 0, 50%, 100% 等）
        '/^border-radius/': ['/^\\d+px$/'],
        // 禁止 font-size 使用硬编码像素值
        'font-size': ['/^\\d+px$/'],
      },
      {
        severity: 'warning',
        message: '请使用设计令牌变量代替硬编码值'
      }
    ]
  },

  // 忽略变量定义文件和第三方样式
  ignoreFiles: [
    '**/variables.scss',
    '**/tokens.scss',
    '**/main.scss',  // CSS 变量定义文件
    '**/node_modules/**',
    '**/dist/**'
  ]
}
